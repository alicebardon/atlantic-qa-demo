/**
 * Atlantic QA Demo — backend proxy
 *
 * Hides the Anthropic + Gemini API keys from the browser.
 * Endpoints:
 *   GET  /api/scenarios         → list available video scenarios
 *   POST /api/gemini-agent      → streams multi-bug video analysis; emits bug_found events
 *   POST /api/orchestrator      → returns JSON ticket ({ qa_report, scenario })
 */

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "\n❌  ANTHROPIC_API_KEY missing. Copy .env.example → .env and fill it in.\n"
  );
  process.exit(1);
}

app.use(express.json({ limit: "20mb" }));
app.use(cors());

// Serve everything in /public (HTML + video + frames)
app.use(express.static(path.join(__dirname, "..", "public")));

// ————————————————————————————————————————————————
// Load all scenarios from public/scenarios/ at startup
// Each scenario dir needs: clip.mp4 (or clip.mov — auto-converted)
// Optional: meta.json with { title, game, engine, platform, tags, source, credit, duration }
// ————————————————————————————————————————————————
const SCENARIOS_DIR = path.join(__dirname, "..", "public", "scenarios");

function loadScenarios() {
  const scenarios = {};
  let dirs;
  try {
    dirs = fs.readdirSync(SCENARIOS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return scenarios;
  }

  for (const id of dirs) {
    const dir = path.join(SCENARIOS_DIR, id);

    // Load meta.json (optional)
    let meta = {};
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
    } catch { /* no meta.json — use defaults */ }

    // Auto-convert clip.mov → clip.mp4 if needed
    const movPath = path.join(dir, "clip.mov");
    const mp4Path = path.join(dir, "clip.mp4");
    if (!fs.existsSync(mp4Path) && fs.existsSync(movPath)) {
      console.log(`  Converting "${id}/clip.mov" → clip.mp4…`);
      const conv = spawnSync("ffmpeg", [
        "-i", movPath,
        "-c:v", "libx264", "-preset", "fast",
        "-c:a", "aac",
        "-movflags", "+faststart",
        "-y", mp4Path,
      ], { encoding: "utf8" });
      if (conv.status !== 0) {
        console.error(`  ❌ Conversion failed for "${id}": ${conv.stderr?.slice(0, 300)}`);
        continue;
      }
      console.log(`  ✓ Converted to clip.mp4`);
    }

    if (!fs.existsSync(mp4Path)) {
      console.warn(`⚠  Scenario "${id}" has no clip.mp4 — skipping`);
      continue;
    }

    scenarios[id] = { id, meta };
    console.log(`✓ Loaded scenario "${id}"`);
  }
  return scenarios;
}

const SCENARIOS = loadScenarios();
const SCENARIO_IDS = Object.keys(SCENARIOS);

if (SCENARIO_IDS.length === 0) {
  console.error("\n❌  No scenarios found in public/scenarios/. Add at least one.\n");
  process.exit(1);
}

// ————————————————————————————————————————————————
// GET /api/scenarios — list available scenarios
// ————————————————————————————————————————————————
app.get("/api/scenarios", (_req, res) => {
  res.json(
    SCENARIO_IDS.map((id) => {
      const { meta } = SCENARIOS[id];
      return { id, ...meta };
    })
  );
});

// ————————————————————————————————————————————————
// POST /api/orchestrator  — takes QA report → structured JSON ticket
// Body: { qa_report, scenario? }
// ————————————————————————————————————————————————
app.post("/api/orchestrator", async (req, res) => {
  const { qa_report, scenario: scenarioId } = req.body;
  if (!qa_report) return res.status(400).json({ error: "Missing qa_report" });

  const scenario = SCENARIOS[scenarioId || SCENARIO_IDS[0]];
  const game = scenario?.meta?.game || "unknown game";

  const systemPrompt = `You are an orchestration agent. Given a QA agent's bug report for ${game}, output a structured JSON bug ticket ready to file in Jira. Your output must be ONLY valid JSON — no markdown fences, no prose — so it can be parsed directly.

Return this exact shape:
{
  "ticket_id": "QA-2026-XXXX" (generate a plausible 4-digit number),
  "title": "short one-line bug title",
  "severity": "low" | "medium" | "high" | "critical",
  "category": "short kebab-case category like 'ragdoll-physics' or 'npc-pathfinding'",
  "affected_entity": "what is bugged",
  "labels": ["array", "of", "kebab-case", "labels"],
  "description": "1-2 sentence summary",
  "repro_steps": ["step 1", "step 2", "step 3"],
  "dedup": {
    "is_duplicate": true | false,
    "similar_count": integer (0 if not duplicate, else 1-15),
    "message": "brief explanation of dedup result"
  },
  "auto_fix_possible": true | false,
  "auto_fix_note": "short explanation of whether this class of bug can be auto-patched or needs engine-team fix"
}

Severity guidance: Ragdoll/visual glitches without crash = medium. Gameplay-blocking = high. Crashes/data loss = critical. Cosmetic only = low.`;

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Here is the QA agent's report. Generate the ticket JSON:\n\n${qa_report}`,
          },
        ],
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      return res.status(upstream.status).send(err);
    }

    const data = await upstream.json();
    let txt = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    txt = txt
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const ticket = JSON.parse(txt);
    res.json(ticket);
  } catch (err) {
    console.error("Orchestrator error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ————————————————————————————————————————————————
// POST /api/gemini-agent  — native video analysis via Gemini 2.5 Flash
// Body: { scenario?: string }
// ————————————————————————————————————————————————
app.post("/api/gemini-agent", async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY not set in .env" });
  }

  const scenarioId = req.body.scenario || SCENARIO_IDS[0];
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) return res.status(404).json({ error: `Unknown scenario: ${scenarioId}` });

  const { meta } = scenario;
  const game = meta.game || "unknown game";
  const engine = meta.engine || "unknown engine";

  const clipPath = path.join(SCENARIOS_DIR, scenarioId, "clip.mp4");
  if (!fs.existsSync(clipPath)) {
    return res.status(404).json({ error: `No clip.mp4 for scenario: ${scenarioId}` });
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  const BASE = "https://generativelanguage.googleapis.com";

  try {
    // 1. Start resumable upload
    const videoBytes = fs.readFileSync(clipPath);
    const startRes = await fetch(`${BASE}/upload/v1beta/files?key=${API_KEY}`, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(videoBytes.length),
        "X-Goog-Upload-Header-Content-Type": "video/mp4",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: scenarioId } }),
    });

    if (!startRes.ok) {
      const err = await startRes.text();
      return res.status(500).json({ error: `Upload start failed: ${err.slice(0, 300)}` });
    }

    const uploadUrl = startRes.headers.get("X-Goog-Upload-URL");
    if (!uploadUrl) return res.status(500).json({ error: "No upload URL from Gemini" });

    // 2. Upload bytes
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Length": String(videoBytes.length),
        "X-Goog-Upload-Command": "upload, finalize",
        "X-Goog-Upload-Offset": "0",
      },
      body: videoBytes,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return res.status(500).json({ error: `Upload failed: ${err.slice(0, 300)}` });
    }

    const fileData = await uploadRes.json();
    const fileUri = fileData.file?.uri;
    const fileName = fileData.file?.name;
    let state = fileData.file?.state;

    if (!fileUri) return res.status(500).json({ error: "No file URI from Gemini" });

    // 3. Poll until ACTIVE
    let attempts = 0;
    while (state !== "ACTIVE" && attempts < 60) {
      await new Promise((r) => setTimeout(r, 2000));
      const pollRes = await fetch(`${BASE}/v1beta/${fileName}?key=${API_KEY}`);
      if (pollRes.ok) ({ state } = await pollRes.json());
      attempts++;
    }

    if (state !== "ACTIVE") {
      return res.status(500).json({ error: "Video processing timed out" });
    }

    // 4. Stream analysis — re-emit as Anthropic-compatible SSE; also emit bug_found events
    const systemInstruction = `You are a senior QA engineer specializing in video game testing. You are watching a gameplay recording and your job is to find and document every bug, glitch, or anomaly.

This is a video game recording. Flag EVERY issue you observe — physics glitches, ragdoll failures, character clipping through geometry, visual artifacts, texture problems, animation errors, collision bugs, NPC behavior issues, object pop-in, flickering, or any behavior that looks unintended or broken.

For EACH bug you find, output it using EXACTLY this format — include the delimiter lines literally:

[BUG]
timestamp: MM:SS
title: short descriptive bug title
description: detailed description of what you observe happening
severity: Critical | High | Medium | Low
category: Physics | Visual | Animation | Collision | AI | Audio | Performance | UI | Other
[/BUG]

Be thorough. Report every anomaly you see, even minor ones. List bugs in chronological order. After all bugs, write a one-sentence overall summary.`;

    const userPrompt = `Watch this full ${game} gameplay recording (engine: ${engine}) from start to finish. You are performing a QA bug review session. Analyze the entire video and flag every bug or anomaly using the exact [BUG]...[/BUG] format. Look for: physics behavior, character and object animations, geometry clipping, visual/texture glitches, ragdoll physics, NPC behavior, environmental bugs, and any behavior that looks broken or unintended in a video game.`;

    const generateRes = await fetch(
      `${BASE}/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{
            role: "user",
            parts: [
              { fileData: { mimeType: "video/mp4", fileUri } },
              { text: userPrompt },
            ],
          }],
          generationConfig: { maxOutputTokens: 4000 },
        }),
      }
    );

    if (!generateRes.ok) {
      const err = await generateRes.text();
      return res.status(generateRes.status).json({ error: `Gemini generate failed: ${err.slice(0, 300)}` });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reader = generateRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let accumulated = "";
    let lastBugEnd = 0;

    function parseBugBlock(content) {
      const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
      const bug = {};
      for (const line of lines) {
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim().toLowerCase().replace(/\s+/g, "_");
        const val = line.slice(colonIdx + 1).trim();
        bug[key] = val;
      }
      return bug;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const json = JSON.parse(raw);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            accumulated += text;
            // Forward text to frontend for live display
            res.write(`data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`);
            // Detect completed [BUG]...[/BUG] blocks
            while (true) {
              const bugStart = accumulated.indexOf("[BUG]", lastBugEnd);
              if (bugStart === -1) break;
              const bugEnd = accumulated.indexOf("[/BUG]", bugStart);
              if (bugEnd === -1) break;
              const bugContent = accumulated.slice(bugStart + 5, bugEnd).trim();
              lastBugEnd = bugEnd + 6;
              const bug = parseBugBlock(bugContent);
              if (bug.title) {
                res.write(`data: ${JSON.stringify({ type: "bug_found", bug })}\n\n`);
              }
            }
          }
        } catch { /* skip malformed */ }
      }
    }

    res.write(`data: ${JSON.stringify({ type: "message_stop" })}\n\n`);
    res.end();
  } catch (err) {
    console.error("Gemini agent error:", err);
    if (!res.headersSent) res.status(500).json({ error: String(err) });
    else res.end();
  }
});

// ————————————————————————————————————————————————
app.listen(PORT, () => {
  console.log(`\n🚀 Atlantic QA Demo running at http://localhost:${PORT}\n`);
});
