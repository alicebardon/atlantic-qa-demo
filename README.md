# Atlantic · Agentic QA Demo

A live demo of the **agentic game QA thesis**: AI agents watch a gameplay video, flag every bug they find, and file structured tickets — automatically.

- **Agent 01 (QA) · Gemini 2.5 Flash** — watches the full gameplay video natively, identifies every bug using structured output, streams findings in real-time.
- **Agent 02 (Orchestrator) · Claude Sonnet 4** — receives each bug one by one as Gemini flags them, produces a Jira-style ticket with severity, dedup check, and auto-fix eligibility.

Multiple bugs → multiple tickets, filed sequentially as the video is analyzed.

---

## Quickstart

```bash
# 1. Install deps
npm install

# 2. Add your API keys
cp .env.example .env
# edit .env and add ANTHROPIC_API_KEY and GEMINI_API_KEY

# 3. Add a gameplay clip
# Drop a clip.mp4 (or clip.mov — auto-converted) into a new folder:
#   public/scenarios/my-game/clip.mp4
# Optionally add a meta.json: { "game": "...", "engine": "...", "title": "..." }

# 4. Run
npm start
# → http://localhost:3000
```

Open the URL, select your scenario, click **Run QA Analysis**, and watch bugs get flagged and tickets filed in real-time.

---

## How it works

```
Browser                  Backend (Node/Express)          AI APIs
───────                  ──────────────────────          ───────
Run QA Analysis ──POST──▶ /api/gemini-agent
                          uploads clip.mp4 to
                          Gemini File API          ──▶   gemini-2.5-flash
                          streams analysis back    ◀──
                          detects [BUG]...[/BUG]
                          emits bug_found events
      ◀── SSE stream ───

  (for each bug_found)
bug report      ──POST──▶ /api/orchestrator        ──▶   claude-sonnet-4
                          parses JSON ticket        ◀──
      ◀── JSON ticket ──
      render ticket card
```

The browser **never** sees any API key. All AI calls go through the local Express proxy.

---

## Project layout

```
atlantic-qa-demo/
├── server/
│   └── index.js               ← Express backend: .mov conversion, Gemini upload,
│                                 bug detection, orchestrator proxy
├── public/
│   ├── index.html             ← 3-panel UI (video / Gemini analysis / tickets)
│   ├── styles.css             ← Dark theme, Atlantic blue/orange
│   ├── app.js                 ← Frontend: SSE handling, rate-limited ticket queue
│   └── scenarios/
│       └── your-scenario/
│           ├── clip.mp4       ← gameplay video (gitignored)
│           └── meta.json      ← optional: game, engine, platform, tags
├── .env.example               ← ANTHROPIC_API_KEY + GEMINI_API_KEY template
└── package.json
```

---

## Adding scenarios

Drop a folder into `public/scenarios/` with a `clip.mp4` (or `clip.mov`):

```
public/scenarios/
└── my-game-bugs/
    ├── clip.mov        ← auto-converted to clip.mp4 on first start
    └── meta.json       ← optional metadata
```

`meta.json` shape:
```json
{
  "title": "Physics bugs compilation",
  "game": "My Game",
  "engine": "Unreal 5",
  "platform": "PC",
  "tags": ["physics", "ragdoll"],
  "duration": 45
}
```

---

## Extending

1. **Real Jira integration** — replace the ticket render with a POST to Jira's REST API. The ticket shape is already Jira-compatible.
2. **Swap models** — try `gemini-2.5-pro` for deeper video analysis, or `claude-haiku-4-5` for the orchestrator for faster/cheaper ticket generation.
3. **Real dedup** — currently simulated by the LLM; plug in FAISS + vector embeddings over past ticket titles.
4. **More agents** — add a Localization agent (per-language visual check), a Performance agent (FPS telemetry), a Regression agent (diff against known-good build).
5. **Webhook output** — have the orchestrator POST tickets directly to Slack, Linear, or GitHub Issues.

---

## Credits

- Demo: Alice Bardon Catineau / Atlantic Labs, April 2026
- Built with Gemini 2.5 Flash (Google) + Claude Sonnet 4 (Anthropic)
