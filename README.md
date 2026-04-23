# Atlantic · Agentic QA Demo

A live demo of the **agentic game QA thesis**: two Claude agents working in sequence to analyze a gameplay bug video and file a structured bug ticket.

- **Agent 01 (QA)** — vision model analyzes 7 keyframes from a gameplay capture, detects the anomaly, classifies the bug.
- **Agent 02 (Orchestrator)** — takes the QA report, produces a structured Jira-style ticket with severity, dedup, auto-fix eligibility.

The video shown is a real Cyberpunk 2077 ragdoll physics bug (credit: Reddit `u/Disrupter52`).

---

## Quickstart

```bash
# 1. Install deps
npm install

# 2. Add your Anthropic API key
cp .env.example .env
# then edit .env and paste your key

# 3. Run
npm start
# → http://localhost:3000
```

That's it. Open the URL, click **Run QA Agent**, and watch both agents work.

---

## Project layout

```
atlantic-qa-demo/
├── server/
│   └── index.js          ← Express backend, hides the API key, proxies to Anthropic
├── public/
│   ├── index.html        ← Three-panel UI (video / agent / orchestrator)
│   ├── styles.css        ← Atlantic house style (Geist, #1F58F2 blue, #E87A2F orange)
│   ├── app.js            ← Frontend logic, calls /api/qa-agent & /api/orchestrator
│   ├── clip.mp4          ← 9-second bug clip (Cyberpunk 2077)
│   └── kf_01.jpg … kf_07.jpg  ← Extracted keyframes
├── .env.example          ← Template for ANTHROPIC_API_KEY
├── .gitignore
└── package.json
```

---

## Architecture

```
Browser                  Backend (Node/Express)          Anthropic API
──────                   ──────────────────────          ─────────────
Run QA Agent  ──POST──▶  /api/qa-agent                   
                         reads keyframes from disk
                         builds multi-image request ──▶  claude-sonnet-4
                         streams SSE response back  ◀──  
     ◀─stream of text────
                                                         
QA report    ──POST──▶   /api/orchestrator                
                         adds system prompt          ──▶  claude-sonnet-4
                         parses JSON response        ◀──  
     ◀──── JSON ────────
Render ticket
```

The browser **never** sees the API key. Everything goes through the local proxy.

---

## Extending with Claude Code

A few directions this can go:

1. **Swap models** — change `claude-sonnet-4-20250514` in `server/index.js` to try Opus for the QA agent and Haiku for the orchestrator (cost/speed tradeoff).
2. **Real Jira integration** — replace the ticket render with a real POST to Jira's REST API. The ticket shape is already Jira-compatible.
3. **Multiple bug types** — add a dropdown to switch between different clips (ragdoll / clipping / pathfinding) and watch the agent handle each.
4. **More agents** — add a Localization agent (vision check per language), a Performance agent (FPS telemetry analysis), etc. — matches the architecture diagram in the deep dive.
5. **Dedup via real embeddings** — currently simulated; plug in FAISS + `voyage-3` embeddings over past ticket titles.

---

## Demo notes

- **What the agent catches**: the Cyberpunk ragdoll bug is subtle but the agent picks it up consistently — a human body pinned to vehicle geometry, visible across multiple frames.
- **Timing**: agent completes in ~3-6s, orchestrator in ~2-3s. The displayed "~15 min human" baseline is conservative — writing a proper bug ticket with repro steps takes longer.
- **Output is live** — every run produces slightly different wording. Run it once before a live demo so you know roughly what to expect.

---

## Credits

- Video: Reddit `u/Disrupter52` (Cyberpunk 2077, © CD Projekt RED)
- Demo: Alice Bardon Catineau / Atlantic Labs, April 2026
- Built with Claude (Anthropic)
