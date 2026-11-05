import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { exec } from "child_process";
import readlineSync from "readline-sync";

// Load variables from .env (if present) into process.env
try {
  process.loadEnvFile(new URL(".env", import.meta.url));
} catch {
  // No .env file — fall back to exported environment variables
}

// 1. Pick an LLM provider
// Put one or both keys in .env:
//   GROQ_API_KEY=...    (https://console.groq.com/keys)
//   GEMINI_API_KEY=...  (https://aistudio.google.com/apikey)
// Set LLM_PROVIDER=groq or LLM_PROVIDER=gemini to choose explicitly;
// otherwise Groq is used when its key is present.
const { GROQ_API_KEY, GEMINI_API_KEY } = process.env;
const PROVIDER = (process.env.LLM_PROVIDER || (GROQ_API_KEY ? "groq" : "gemini")).toLowerCase();

const MODELS = {
  groq: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  gemini: process.env.GEMINI_MODEL || "gemini-3.8-flash",
};
const MODEL = MODELS[PROVIDER];

if (!MODEL) {
  console.error(`❌ Unknown LLM_PROVIDER "${PROVIDER}". Use "groq" or "gemini".`);
  process.exit(1);
}

const apiKey = PROVIDER === "groq" ? GROQ_API_KEY : GEMINI_API_KEY;
if (!apiKey) {
  const keyName = PROVIDER === "groq" ? "GROQ_API_KEY" : "GEMINI_API_KEY";
  console.error(`❌ Missing ${keyName} environment variable.`);
  console.error(`   Add ${keyName}=your-key-here to .env (or export it)`);
  process.exit(1);
}

const client = PROVIDER === "groq" ? new Groq({ apiKey }) : new GoogleGenAI({ apiKey });

// Send the conversation to the selected provider and return the reply text.
// `messages` uses OpenAI-style roles: "user" and "assistant".
async function chat(messages) {
  if (PROVIDER === "groq") {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      response_format: { type: "json_object" },
    });
    return completion.choices[0].message.content;
  }

  // Gemini uses "user" / "model" roles; the system prompt goes in config.systemInstruction
  const response = await client.models.generateContent({
    model: MODEL,
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
    },
  });
  return response.text;
}

// 2. Define Custom Tool for Command Execution
// Failures are returned as text (not thrown) so the agent can see the error and recover.
function executeCommand(command) {
  return new Promise((resolve) => {
    exec(command, (error, stdout, stderr) => {
      const errorText = error ? `ERROR:\n${error.message}\n` : "";
      resolve(`${errorText}STDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    });
  });
}

const toolsMap = {
  executeCommand: executeCommand,
};

// 3. System Prompt establishing the Agent's workflow loop (Think -> Action -> Observe)
const SYSTEM_PROMPT = `
You are an autonomous AI Coding Agent (like Cursor CLI / Claude Code) designed to solve user software development queries.
You work in an iterative loop of: START -> THINK -> ACTION -> OBSERVE -> OUTPUT.

Available Tools:
- executeCommand(command: string): Executes a given Linux/Terminal command on the user's device and returns STDOUT and STDERR.

Rules:
1. Always output strictly in valid JSON format.
2. Output exactly ONE JSON object (one step) per response.
3. Only call tools from the available tools list.
4. After an "action" step, wait for the "observe" message before proceeding.

Output Format Example:
{
  "step": "think",
  "content": "The user wants to create a React app. I should create a directory."
}
{
  "step": "action",
  "tool": "executeCommand",
  "input": "mkdir my-app"
}
{
  "step": "output",
  "content": "The app has been successfully created!"
}
`;

async function runAgent() {
  console.log(`⚙️  Using ${PROVIDER} (${MODEL})`);
  const messages = [];

  // Prompt the user for what to build directly from the terminal
  const userQuery = readlineSync.question("What would you like me to build? ");
  messages.push({ role: "user", content: userQuery });

  while (true) {
    try {
      const responseText = await chat(messages);
      messages.push({ role: "assistant", content: responseText });

      let parsedResponse = JSON.parse(responseText);
      // Occasionally the model wraps a single step in an array
      if (Array.isArray(parsedResponse)) parsedResponse = parsedResponse[0];

      // Handle 'think' step
      if (parsedResponse.step === "think") {
        console.log(`🧠 [THINK]: ${parsedResponse.content}`);
        messages.push({ role: "user", content: "Continue with the next step." });
        continue;
      }

      // Handle 'output' step (Final response to user)
      if (parsedResponse.step === "output") {
        console.log(`🤖 [AGENT]: ${parsedResponse.content}`);
        break;
      }

      // Handle 'action' step (Tool execution)
      if (parsedResponse.step === "action") {
        console.log(`🛠️ [TOOL CALL]: ${parsedResponse.tool} with input:`, parsedResponse.input);

        const toolFn = toolsMap[parsedResponse.tool];
        if (!toolFn) {
          throw new Error(`Tool ${parsedResponse.tool} not found!`);
        }

        // Execute command and collect observation output
        const observation = await toolFn(parsedResponse.input);
        console.log(`👁️ [OBSERVATION]:\n${observation}`);

        // Feed observation back into conversation history
        messages.push({
          role: "user",
          content: JSON.stringify({ step: "observe", content: observation }),
        });

        continue;
      }

      throw new Error(`Unknown step: ${responseText}`);
    } catch (error) {
      if (error?.status === 429) {
        console.error(`❌ ${PROVIDER} rate limit / quota exceeded for model "${MODEL}".`);
        console.error("   Wait for it to reset, or switch provider/model in .env:");
        console.error("   LLM_PROVIDER=groq|gemini, GROQ_MODEL=<name>, GEMINI_MODEL=<name>");
      } else {
        console.error("❌ Error:", error);
      }
      break;
    }
  }
}

runAgent();
