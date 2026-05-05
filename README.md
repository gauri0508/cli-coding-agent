# CLI Coding Agent

A conversational CLI agent — similar to Cursor / Windsurf — that takes natural language instructions in the terminal and produces real working code on disk. Powered by **Groq** running **Llama 3.3 70B** (free tier).

Built as Assignment 02 (Prompt Engineering / GenAI). Demo task: clone the Scaler Academy website (Header + Hero + Footer) from a single prompt.

## How it works

The agent runs a strict **ReAct loop**: `START → THINK → TOOL → OBSERVE → THINK → ... → OUTPUT`. It emits one JSON step per turn, calls a tool, observes the result, and keeps reasoning until the task is done.

Tools available to the agent:
- `createFolder(folderpath)` — creates a folder (recursive)
- `writeFile({ filepath, content })` — writes a file with full content
- `executeCommand(cmd)` — runs a shell command

## Setup

```bash
git clone <this-repo>
cd cli-coding-agent
npm install
cp .env.example .env
```

Get a free Groq API key from [console.groq.com/keys](https://console.groq.com/keys) (no credit card required) and paste it into `.env`:

```
GROQ_API_KEY=your_key_here
```

## Run

```bash
npm start
```

You'll get a prompt:

```
CLI Coding Agent — powered by Groq (Llama 3.3 70B)
Type your instruction. Use 'exit' or Ctrl+C to quit.

you > _
```

## Example prompts

```
Clone the Scaler Academy website into a folder called scaler-clone
```

```
Create a folder called todo-app and build a simple todo list page in it
```

```
Make a landing page for a coffee shop called "Beanly" in a folder called beanly
```

After the agent finishes, open the generated `index.html` in your browser.

## What you'll see

```
you > Clone the Scaler Academy website into a folder called scaler-clone

[START] User wants me to clone the Scaler Academy website...
[THINK] I should plan the structure: Header, Hero, Footer in three files...
[THINK] I'll create the folder first, then write index.html, style.css, script.js.
[TOOL ] createFolder("scaler-clone")
[OBSRV] Created folder scaler-clone
[TOOL ] writeFile({"filepath":"scaler-clone/index.html","content":"..."})
[OBSRV] Wrote 2341 bytes to scaler-clone/index.html
...
[OUTPUT] Done. Open scaler-clone/index.html in your browser.
```

## Project structure

```
cli-coding-agent/
├── index.js          # Agent loop, tools, CLI
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## Stack

- **Node.js** (ES modules)
- **groq-sdk** — Groq SDK (OpenAI-compatible)
- **llama-3.3-70b-versatile** — free tier (~30 req/min, generous daily quota)
- **readline/promises** — terminal input
- No paid services
