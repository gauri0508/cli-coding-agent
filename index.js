import "dotenv/config";
import Groq from "groq-sdk";
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

// =====================================================================
// TOOLS — the agent calls these by name. Each takes a single args object
// (or a string for executeCommand) and returns a string the LLM observes.
// =====================================================================

async function writeFile(args) {
  const filepath = args.filepath ?? args.path;
  const content = args.content ?? "";
  if (!filepath) throw new Error("writeFile requires 'filepath'");
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, content, "utf8");
  return `Wrote ${content.length} bytes to ${filepath}`;
}

async function createFolder(args) {
  const folderpath =
    typeof args === "string" ? args : args.folderpath ?? args.path;
  if (!folderpath) throw new Error("createFolder requires 'folderpath'");
  await fs.mkdir(folderpath, { recursive: true });
  return `Created folder ${folderpath}`;
}

async function executeCommand(args) {
  const cmd = typeof args === "string" ? args : args.cmd ?? args.command;
  if (!cmd) throw new Error("executeCommand requires 'cmd'");
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 1024 * 1024 * 5 }, (err, stdout, stderr) => {
      if (err) return reject(stderr?.trim() || err.message);
      resolve(stdout?.trim() || `Command "${cmd}" executed (no stdout).`);
    });
  });
}

const tool_map = {
  writeFile,
  createFolder,
  executeCommand,
};

// =====================================================================
// SYSTEM PROMPT — teaches the model the ReAct format and the Scaler task
// =====================================================================

const SYSTEM_PROMPT = `
You are a CLI coding agent (similar to Cursor / Windsurf) that builds real
websites on the user's machine. You operate in a strict step-by-step loop:
START -> THINK -> TOOL -> OBSERVE -> THINK -> ... -> OUTPUT.

You MUST respond with a SINGLE JSON object per turn — never multiple steps
in one response. After each TOOL step you MUST stop and wait for the
OBSERVE step from the developer before continuing.

# Available tools
1. createFolder(folderpath: string)
   - Creates a folder (recursive). Use before writing files into it.
2. writeFile({ filepath: string, content: string })
   - Writes a file. Pass full file content as a JSON string. Always use
     this for HTML, CSS, JS files (NOT executeCommand with echo/heredoc).
3. executeCommand(cmd: string)
   - Runs a shell command. Use for ls, opening files, etc.

# Rules
1. Always reply with ONE valid JSON object — no prose, no markdown fences.
2. One step per response. After TOOL, stop and wait for OBSERVE.
3. Do MULTIPLE THINK steps to plan before producing TOOL or OUTPUT.
4. Use writeFile for any file content. Never echo HTML/CSS/JS through the
   shell — quoting will break.
5. When the user asks to clone Scaler Academy (or any website), produce
   a folder containing index.html, style.css, script.js with at minimum:
     - Header (logo + nav links: Courses, Login, Sign Up)
     - Hero section (headline like "Accelerate your Tech Career",
       subheadline, primary CTA button)
     - Footer (links + copyright)
   Use Scaler's visual style: dark navy background (#0a0e27 / #11142a),
   white text, an accent color like #ee7a3a (orange) or #4f8cff (blue)
   for CTAs. Make it visually polished, not a wireframe. Include real
   sections like Courses, Why Scaler, Testimonials if you have budget.
6. Finish with an OUTPUT step that tells the user what was built and how
   to open it (e.g. "open scaler-clone/index.html in your browser").

# JSON schema (every response)
{ "step": "START" | "THINK" | "TOOL" | "OUTPUT",
  "content": "string (required for START, THINK, OUTPUT)",
  "tool_name": "string (required for TOOL)",
  "tool_args": "string OR object (required for TOOL)" }

# Example (file creation)
user: Create a hello world page in a folder called demo.
assistant: {"step":"START","content":"User wants a hello world HTML page in a folder called demo."}
assistant: {"step":"THINK","content":"Plan: create folder 'demo', then writeFile demo/index.html with a minimal HTML page."}
assistant: {"step":"TOOL","tool_name":"createFolder","tool_args":"demo"}
developer: {"step":"OBSERVE","content":"Created folder demo"}
assistant: {"step":"THINK","content":"Folder ready. Now writing index.html."}
assistant: {"step":"TOOL","tool_name":"writeFile","tool_args":{"filepath":"demo/index.html","content":"<!doctype html><html><body><h1>Hello World</h1></body></html>"}}
developer: {"step":"OBSERVE","content":"Wrote 64 bytes to demo/index.html"}
assistant: {"step":"OUTPUT","content":"Done. Open demo/index.html in your browser."}
`.trim();

// =====================================================================
// AGENT — Groq chat completions, runs the ReAct loop until OUTPUT
// =====================================================================

if (!process.env.GROQ_API_KEY) {
  console.error(
    "Missing GROQ_API_KEY in .env. Get one free at https://console.groq.com/keys"
  );
  process.exit(1);
}

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "llama-3.3-70b-versatile";

function safeParse(text) {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  return JSON.parse(t);
}

async function runAgent(messages, userMessage) {
  messages.push({ role: "user", content: userMessage });
  const MAX_STEPS = 40;

  for (let step = 0; step < MAX_STEPS; step++) {
    let parsed, raw;
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.4,
      });
      raw = completion.choices[0].message.content;
      parsed = safeParse(raw);
    } catch (err) {
      console.error("\n[agent] LLM/parse error:", err.message);
      if (raw) console.error("[agent] raw response:", raw.slice(0, 300));
      return;
    }

    messages.push({ role: "assistant", content: JSON.stringify(parsed) });

    if (parsed.step === "START") {
      console.log("\n[START]", parsed.content);
    } else if (parsed.step === "THINK") {
      console.log("[THINK]", parsed.content);
    } else if (parsed.step === "TOOL") {
      const { tool_name, tool_args } = parsed;
      console.log(`[TOOL ] ${tool_name}(${preview(tool_args)})`);
      const fn = tool_map[tool_name];
      let observation;
      if (!fn) {
        observation = `Tool "${tool_name}" is not available. Tools: ${Object.keys(tool_map).join(", ")}.`;
      } else {
        try {
          observation = await fn(tool_args);
        } catch (e) {
          observation = `ERROR: ${e.message || String(e)}`;
        }
      }
      console.log(`[OBSRV] ${truncate(observation, 200)}`);
      messages.push({
        role: "user",
        content: JSON.stringify({ step: "OBSERVE", content: observation }),
      });
      continue;
    } else if (parsed.step === "OUTPUT") {
      console.log("\n[OUTPUT]", parsed.content, "\n");
      return;
    } else {
      console.log("[?]", parsed);
    }
  }

  console.log("\n[agent] Hit max steps — ending turn.\n");
}

function preview(args) {
  if (args == null) return "";
  if (typeof args === "string") return JSON.stringify(args);
  const s = JSON.stringify(args);
  return s.length > 80 ? s.slice(0, 77) + "..." : s;
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + "..." : s;
}

// =====================================================================
// CLI — readline loop. One persistent message history per session, so
// the agent remembers prior turns within a single CLI session.
// =====================================================================

async function main() {
  console.log("CLI Coding Agent — powered by Groq (Llama 3.3 70B)");
  console.log("Type your instruction. Use 'exit' or Ctrl+C to quit.\n");
  console.log(
    "Example: Clone the Scaler Academy website into a folder called scaler-clone\n"
  );

  const messages = [{ role: "system", content: SYSTEM_PROMPT }];
  const rl = readline.createInterface({ input, output });

  while (true) {
    let userInput;
    try {
      userInput = (await rl.question("you > ")).trim();
    } catch {
      break;
    }
    if (!userInput) continue;
    if (["exit", "quit", ":q"].includes(userInput.toLowerCase())) break;
    await runAgent(messages, userInput);
  }

  rl.close();
  console.log("Bye.");
}

main();
