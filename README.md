# ai-agent-like-cursor

A minimal autonomous coding agent for the terminal, in the spirit of Cursor CLI / Claude Code.
You describe what you want built, and the agent loops through **think → action → observe → output**,
running shell commands on your machine until the task is done.

It supports two LLM providers:

- **[Groq](https://console.groq.com/)** (default when `GROQ_API_KEY` is set), using `openai/gpt-oss-120b`
- **[Google Gemini](https://aistudio.google.com/)**, using `gemini-3.8-flash`

> [!WARNING]
> The agent runs every shell command the model asks for, **without asking you first**.
> Run it in a throwaway directory, container or VM, and never point it at anything you can't afford to lose.

## How it works

```
 you ──► "What would you like me to build?"
                    │
                    ▼
        ┌──────────────────────┐
        │   LLM (Groq/Gemini)  │◄─────────────────────┐
        └──────────┬───────────┘                      │
                   │ one JSON step per reply          │
     ┌─────────────┼───────────────┐                  │
     ▼             ▼               ▼                  │
  "think"       "action"        "output"              │
  log it,       run the shell   print the final       │
  continue      command         answer and stop       │
                   │                                  │
                   └── stdout/stderr sent back ───────┘
                       as an "observe" step
```

1. You type a request at the prompt.
2. The model answers with exactly one JSON object per turn, which has a `step` field:
   - `think`: its reasoning, printed as `🧠 [THINK]`
   - `action`: a tool call, for example `{ "step": "action", "tool": "executeCommand", "input": "mkdir my-app" }`
   - `output`: the final answer, printed as `🤖 [AGENT]`, which ends the run
3. For each `action`, the agent runs the command with Node's `child_process.exec` and sends the
   result back to the model as an `observe` step. The result includes stdout, stderr and any error.
   Failed commands are returned to the model as text instead of crashing the loop, so the model can recover.

The only tool available is `executeCommand(command)`.

## Requirements

- **Node.js 20.12 or newer**, because the app loads `.env` with `process.loadEnvFile`
- An API key for at least one provider:
  - Groq: <https://console.groq.com/keys>
  - Gemini: <https://aistudio.google.com/apikey>

## Setup

```bash
git clone <this-repo-url>
cd ai-agent-like-cursor
npm install
```

Create a `.env` file in the project root. It is already listed in `.gitignore`.

```dotenv
# At least one of these is required
GROQ_API_KEY=your-groq-key
GEMINI_API_KEY=your-gemini-key

# Optional
LLM_PROVIDER=groq            # "groq" or "gemini"; defaults to groq if GROQ_API_KEY is set
GROQ_MODEL=openai/gpt-oss-120b
GEMINI_MODEL=gemini-3.8-flash
```

You can also export these variables in your shell instead of using `.env`.

### Configuration reference

| Variable         | Required                    | Default                                       | Description                        |
| ---------------- | --------------------------- | --------------------------------------------- | ---------------------------------- |
| `GROQ_API_KEY`   | if using Groq               | none                                          | Groq API key                       |
| `GEMINI_API_KEY` | if using Gemini             | none                                          | Google Gemini API key              |
| `LLM_PROVIDER`   | no                          | `groq` if `GROQ_API_KEY` is set, else `gemini` | Which provider to use              |
| `GROQ_MODEL`     | no                          | `openai/gpt-oss-120b`                         | Model name passed to Groq          |
| `GEMINI_MODEL`   | no                          | `gemini-3.8-flash`                            | Model name passed to Gemini        |

## Usage

```bash
npm start
```

Example session:

```
⚙️  Using groq (openai/gpt-oss-120b)
What would you like me to build? create a folder called demo with a hello.js that prints hello world
🧠 [THINK]: I need to create a directory named demo and a file inside it.
🛠️ [TOOL CALL]: executeCommand with input: mkdir demo
👁️ [OBSERVATION]:
STDOUT:

STDERR:

🛠️ [TOOL CALL]: executeCommand with input: echo "console.log('hello world')" > demo/hello.js
...
🤖 [AGENT]: Created demo/hello.js, which prints "hello world".
```

Commands run in the directory where you started `npm start`.

## Project structure

```
.
├── index.js                     # The agent: provider setup, system prompt, tool, main loop
├── rahul/
│   └── matrixMultiplication.js  # Example script (matrix multiplication)
├── package.json
└── .env                         # Your API keys (not committed)
```

## Troubleshooting

| Message                                     | Fix                                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `❌ Missing GROQ_API_KEY environment variable` | Add the key to `.env`, or set `LLM_PROVIDER=gemini` if you only have a Gemini key.         |
| `❌ Unknown LLM_PROVIDER "..."`              | `LLM_PROVIDER` must be `groq` or `gemini`.                                                |
| `❌ ... rate limit / quota exceeded`         | Wait for the quota to reset, or switch to another provider or model in `.env`.             |
| `SyntaxError` from `JSON.parse`             | The model returned something that is not valid JSON. Run it again, or try a different model. |
| `process.loadEnvFile is not a function`     | Upgrade to Node.js 20.12 or newer.                                                        |

## Ideas for extending it

- Ask for confirmation before running each command
- Add more tools, such as `readFile`, `writeFile` or `listDirectory`, by adding them to `toolsMap` and the system prompt
- Let the user send follow-up requests after the agent finishes instead of exiting
- Cap the number of loop iterations so a confused model can't run forever

## License

ISC
