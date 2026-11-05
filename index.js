import { GoogleGenAI } from "@google/genai";
import { exec } from "child_process";
import readlineSync from "readline-sync";

// Load variables from .env (if present) into process.env
try {
  process.loadEnvFile(new URL(".env", import.meta.url));
} catch {
  // No .env file — fall back to exported environment variables
}

// 1. Initialize Gemini Client
// Get a key from https://aistudio.google.com/apikey and put it in .env:
//   GEMINI_API_KEY=your-key-here
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

if (!GEMINI_API_KEY) {
  console.error("❌ Missing GEMINI_API_KEY environment variable.");
  console.error('   Add GEMINI_API_KEY=your-key-here to .env (or export it)');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

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
  // Gemini uses "user" / "model" roles; the system prompt goes in config.systemInstruction
  const contents = [];

  // Prompt the user for what to build directly from the terminal
  const userQuery = readlineSync.question("What would you like me to build? ");
  contents.push({ role: "user", parts: [{ text: userQuery }] });

  while (true) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
        },
      });

      const responseText = response.text;
      contents.push({ role: "model", parts: [{ text: responseText }] });

      let parsedResponse = JSON.parse(responseText);
      // Occasionally the model wraps a single step in an array
      if (Array.isArray(parsedResponse)) parsedResponse = parsedResponse[0];

      // Handle 'think' step
      if (parsedResponse.step === "think") {
        console.log(`🧠 [THINK]: ${parsedResponse.content}`);
        contents.push({ role: "user", parts: [{ text: "Continue with the next step." }] });
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
        contents.push({
          role: "user",
          parts: [{ text: JSON.stringify({ step: "observe", content: observation }) }],
        });

        continue;
      }

      throw new Error(`Unknown step: ${responseText}`);
    } catch (error) {
      console.error("❌ Error:", error);
      break;
    }
  }
}

runAgent();
