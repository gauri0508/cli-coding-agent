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
5. When the user asks to clone Scaler Academy (https://scaler.com/academy/),
   produce a folder containing index.html, style.css, script.js. Use
   the EXACT copy and structure below — this is a faithful clone, not
   a generic landing page.

   === HEADER (sticky, WHITE background, subtle bottom border on scroll) ===
   - Left: bold royal-blue "SCALER" wordmark (uppercase, font-weight 800,
     color #2563eb), plus a small blue square icon ◼ beside it.
   - Center nav links (all UPPERCASE, font-size 13px, letter-spacing 0.5px,
     color #0f172a, with ▾ chevron on dropdowns):
       PROGRAM ▾   MASTERCLASS   AI LABS   ALUMNI   RESOURCES ▾
   - Right side, in this order:
       • "Login" plain text link (color #0f172a, 14px)
       • Filled royal-blue button "Request A Callback ↗" (bg #2563eb,
         white text, 10px radius, 10px 20px padding)

   === HERO (FULL-WIDTH ATMOSPHERIC GRADIENT BACKGROUND, single column, centered) ===
   Background — this is critical, do NOT use plain white:
     background: radial-gradient(ellipse 120% 80% at 50% 20%,
       #d4e8ec 0%, #a8c8d8 30%, #7da0c8 60%, #5e7eb8 100%);
     Or as a fallback, a linear-gradient version:
     background: linear-gradient(160deg, #c8e0e5 0%, #8db3cc 45%, #6088c0 100%);
   The hero is centered (text-align: center), padding 80px 24px 120px,
   min-height ~600px. ALL hero text is WHITE.

   Hero content (centered stack):
     - Top: small chevron divider line "‹  SCALER ACADEMY  |  12 MONTH PROGRAM  ›"
       (color rgba(255,255,255,0.85), uppercase, letter-spacing 1px, ~13px)
     - Headline (font-size clamp(40px, 6vw, 72px), font-weight 700,
       line-height 1.1, color WHITE, max-width 900px, margin 24px auto):
         "Modern Software"  on line 1
         "and AI Engineering."  on line 2
     - Subheadline (~17px, color rgba(255,255,255,0.92),
       max-width 720px, margin 24px auto, line-height 1.55):
         "Software Engineering hasn't changed. What it takes to be great at it has.
          Stronger fundamentals, faster delivery, and AI fluency built into how you
          learn, not just an add on."
     - Two buttons centered, ~24px gap:
         • Primary filled royal-blue: "DOWNLOAD BROCHURE" (bg #2563eb, white,
           uppercase, font-weight 700, letter-spacing 0.5px, 14px 32px padding)
         • Secondary white-filled: "TALK TO AN ADVISOR" (bg white, color #0f172a,
           same uppercase styling)
     - Tiny caption below buttons (color rgba(255,255,255,0.75), ~13px):
         "Next cohort starts May 2026"

   === STATS STRIP (white bg, 4 large numbers in a row) ===
   - 163% — "Growth in AI-related job postings (2024-2025)"
   - #1 — "'AI Engineer' ranked fastest-growing job title (LinkedIn 2026)"
   - 78% — "of IT job postings demand AI expertise"
   - $206K — "Average AI engineer salary in 2025"
   Numbers: ~48px font-weight 800 in indigo. Caption below: ~14px #475569.

   === AI-INTEGRATED CURRICULUM ===
   Section title (~40px bold): "AI-Integrated Curriculum"
   Subtitle: "Software Engineering Has Changed. So Has This Program."
   3 feature cards in a row (white bg, border, padding 32px):
     1. 🧠  "Fundamentals First" — Build the engineering bedrock that
            AI tools amplify, not replace.
     2. 🤖  "AI as Operating System" — Every module integrates LLMs,
            agents, and AI-assisted workflows.
     3. 🎯  "Built for the AI Shift" — A curriculum that raises the bar
            for what a great engineer means today.

   === CURRICULUM TRACKS (light-gray bg #f8fafc) ===
   Title: "Curriculum"
   Subtitle: "Find the AI Path for your role"
   List of tracks as cards (each card: title, duration pill, sessions count):
     • Programming Fundamentals — 2 months · 27 sessions
     • Intermediate DSA: AI-Assisted Problem Solving — 1 month · 12 sessions
     • AI & Agents: From Talking to AI to Building One — 1 month · 11 sessions
     • Advanced DSA: Foundations, Core Techniques & Optimisation — 4 months · 59 sessions
     • Advanced DSA: DP, Heaps & Graphs — 4 months · 18 sessions

   === PROJECTS (white bg) ===
   Title: "Every project ships with an AI layer. That's the new bar."
   4 project cards in a 2x2 or row grid:
     1. LinkForge AI — HTML, CSS, Responsive Design, Portfolio
     2. SkyAI Advisor — JavaScript, APIs, Weather App
     3. Kanban Board — Trello-style productivity tool
     4. ShowKart — MERN Capstone, e-commerce
   Each card: title, short description, tech-stack tags as small pills.

   === INSTRUCTORS (light-gray bg) ===
   Title: "Learn from the top 0.1% of practitioners."
   Cards in a row (avatar circle with initials + colored bg):
     • Anshuman Singh — Co-Founder, Scaler · 8+ YOE
     • Naman Bhalla — Engineering Mentor · 7+ YOE
     • Anurag Khanna — Senior Software Engineer · 10+ YOE
     • Kshitij Mishra — AI Engineer · 6+ YOE
   Each card: avatar, name, title, YOE, ⭐ 4.9 rating.

   === SUCCESS STORIES ===
   Title: "Real career moves"
   2-3 testimonial cards: quote, student name, "Now: <new role at Big Tech>",
   "Before: <previous role>", an "OFFERS: 3" pill.

   === PRICING ===
   Title: "Program Fee"
   Two highlighted lines:
     - "Starting at ₹9,791/month"  (indigo, large)
     - "Total ₹3,99,000*"  (smaller, gray)
   Bullets: No-cost EMI · Flexible payments · Lifelong access · Career support.

   === FAQ ===
   Title: "Frequently Asked Questions"
   At least 4 collapsible Q/A items (use <details><summary> for native
   accordion behavior, no JS needed).

   === FOOTER (dark navy bg #0f172a, white text) ===
   4 columns:
     - Explore Scaler: Academy, Data Science, DevOps, Neovarsity
     - Resources: Blog, Tutorials, Compensation, Topics
     - Others: Refer & Earn, Reviews, Privacy, Terms
     - Social: YouTube · LinkedIn · Instagram · Twitter (text or emoji icons)
   Below columns: small line "© 2026 InterviewBit Software Services LLP. All rights reserved."

   === STICKY BOTTOM CONTACT BAR ===
   A dark navy bar fixed to the bottom of the viewport (position: fixed,
   bottom: 0, left: 0, right: 0, z-index: 50):
     - Background: #0f172a, color: white, padding: 14px 24px, font-size 14px
     - Centered text: "Need help? Talk to us at  08045579575"
     - To the right of the number, a "Request a Call ↗" link in royal blue
   Add bottom padding to <body> so this bar doesn't cover content.

   === VISUAL STYLE ===
   - Page bg: #ffffff. Alt sections: #f8fafc.
   - Primary text: #0f172a. Secondary: #475569. Muted: #64748b.
   - Brand royal blue: #2563eb (hover #1d4ed8). Use this everywhere
     (logo, primary buttons, links, accent highlights). DO NOT use indigo.
   - Font: import Inter from Google Fonts; system-ui fallback.
     Use weights 400, 600, 700, 800.
   - Container max-width: 1200px, padding 0 24px.
   - Section vertical padding: 96px on desktop.
   - Cards: white bg, 16px radius, 1px solid #e2e8f0,
     box-shadow: 0 4px 24px rgba(15,23,42,0.06).
   - Buttons: 10px radius, 14px 28px padding, font-weight 700,
     transition all 0.2s, hover translateY(-1px) + darker shade.
   - Badge pills: 999px radius, 6px 14px, bg #dbeafe, text #2563eb, 13px.
   - Make spacing generous and typography crisp. Polished, not skeletal.

   === script.js ===
   - Smooth scroll for in-page anchor links.
   - Add a "scrolled" class to the header when window.scrollY > 8 so a
     shadow appears on scroll.
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
// Free-tier note: 70B has 100K tokens/day. Use "llama-3.1-8b-instant" if
// you hit the 70B daily limit — different quota bucket, smaller quality.
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
