/**
 * Atlantic QA Demo — Multi-Agent Parallel frontend
 *
 * 3 Gemini agents watch 3 videos simultaneously.
 * Bugs flow into a shared orchestrator queue.
 * Low severity bugs are dismissed and counted; rest get Jira tickets.
 */

const NUM_SLOTS = 3;
const SLOT_LABELS = ['A', 'B', 'C'];

let SCENARIOS = [];

// ————————————————————————————————————————————————
// DOM helpers
// ————————————————————————————————————————————————
function slotEls(i) {
  return {
    select:  document.getElementById(`slot-select-${i}`),
    player:  document.getElementById(`slot-player-${i}`),
    buglog:  document.getElementById(`slot-buglog-${i}`),
    dot:     document.getElementById(`slot-dot-${i}`),
    status:  document.getElementById(`slot-status-${i}`),
  };
}

const runBtn   = document.getElementById('run-btn');
const orchBody = document.getElementById('orch-body');
const orchDot  = document.getElementById('orch-dot');
const orchStatus = document.getElementById('orch-status');

// ————————————————————————————————————————————————
// Bootstrap
// ————————————————————————————————————————————————
(async function init() {
  try {
    const res = await fetch('/api/scenarios');
    SCENARIOS = await res.json();
  } catch (err) {
    console.error('Failed to load scenarios:', err);
    return;
  }

  if (SCENARIOS.length === 0) {
    document.querySelector('h1').textContent = 'No scenarios found';
    return;
  }

  // Populate all 3 slot selectors and load their videos
  for (let i = 0; i < NUM_SLOTS; i++) {
    const { select, player } = slotEls(i);
    for (const s of SCENARIOS) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.game ? `${s.game} — ${s.title || s.id}` : s.title || s.id;
      select.appendChild(opt);
    }
    // Default each slot to a different scenario if available, else wrap around
    const defaultIdx = i % SCENARIOS.length;
    select.value = SCENARIOS[defaultIdx].id;
    player.src = `/scenarios/${SCENARIOS[defaultIdx].id}/clip.mp4`;
    player.load();

    select.addEventListener('change', () => {
      player.src = `/scenarios/${select.value}/clip.mp4`;
      player.load();
    });
  }
})();

// ————————————————————————————————————————————————
// Utilities
// ————————————————————————————————————————————————
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ————————————————————————————————————————————————
// API
// ————————————————————————————————————————————————
async function callGeminiAgent(scenarioId, onChunk, onBugFound) {
  const response = await fetch('/api/gemini-agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario: scenarioId }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${response.status}: ${err.slice(0, 200)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const evt = JSON.parse(payload);
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          onChunk();
        } else if (evt.type === 'bug_found' && evt.bug) {
          onBugFound(evt.bug);
        }
      } catch (_) { /* skip */ }
    }
  }
}

async function callOrchestrator(qaReport, scenarioId) {
  const response = await fetch('/api/orchestrator', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qa_report: qaReport, scenario: scenarioId }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${response.status}: ${err.slice(0, 200)}`);
  }
  return response.json();
}

// ————————————————————————————————————————————————
// Ticket rendering
// ————————————————————————————————————————————————
function renderPendingCardHTML(idx, slotLabel, bugTitle, bugTimestamp) {
  return `
    <div class="ticket-pending">
      <span class="status-dot active"></span>
      <div>
        <span class="ticket-slot">Slot ${escapeHtml(slotLabel)}</span>
        <b style="margin-left:6px">${escapeHtml(bugTitle || 'Detected issue')}</b>
        ${bugTimestamp ? `<span style="color:var(--ink-faint);font-size:11px;margin-left:6px">@ ${escapeHtml(bugTimestamp)}</span>` : ''}
        <div class="ticket-pending-status" style="font-size:11px;color:var(--ink-faint);margin-top:3px">Queued…</div>
      </div>
    </div>`;
}

function renderTicketHTML(t, elapsedSec, idx, slotLabel, bugTimestamp) {
  const sevClass = `sev-${t.severity}`;
  const labelsHTML = (t.labels || []).map(l => `<span class="label-chip">${escapeHtml(l)}</span>`).join('');
  const steps = (t.repro_steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');

  return `
    <div class="ticket">
      <div class="ticket-header">
        <span class="ticket-id">${escapeHtml(t.ticket_id)}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="ticket-slot">Slot ${escapeHtml(slotLabel)}</span>
          <span class="ticket-system">${bugTimestamp ? escapeHtml(bugTimestamp) + ' · ' : ''}Jira · auto-filed</span>
        </div>
      </div>
      <div class="ticket-title">${escapeHtml(t.title)}</div>
      <div class="ticket-row">
        <div class="k">Severity</div>
        <div class="v"><span class="sev ${sevClass}">${escapeHtml(t.severity)}</span></div>
      </div>
      <div class="ticket-row">
        <div class="k">Category</div>
        <div class="v"><code style="font-family:'Geist Mono',monospace;font-size:11.5px;background:var(--chip-bg);padding:1px 5px;border-radius:2px">${escapeHtml(t.category)}</code></div>
      </div>
      <div class="ticket-row">
        <div class="k">Entity</div>
        <div class="v">${escapeHtml(t.affected_entity)}</div>
      </div>
      <div class="ticket-row">
        <div class="k">Labels</div>
        <div class="v"><div class="labels">${labelsHTML}</div></div>
      </div>
      <div class="ticket-desc">
        <h4>Description</h4>
        <p>${escapeHtml(t.description)}</p>
        <h4>Reproduction steps</h4>
        <ol>${steps}</ol>
      </div>
    </div>
    <div class="dedup">
      <span class="icon">${t.dedup?.is_duplicate ? '⊕' : '✓'}</span>
      <div>
        <b>${t.dedup?.is_duplicate ? `Duplicate · ${t.dedup.similar_count} prior report${t.dedup.similar_count===1?'':'s'}` : 'No duplicates · new ticket'}</b>
        ${escapeHtml(t.dedup?.message || '')}
      </div>
    </div>
    <div class="autofix">
      <b>Auto-fix:</b> ${t.auto_fix_possible ? 'eligible' : 'not eligible'} — ${escapeHtml(t.auto_fix_note || '')}
    </div>
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--rule);display:flex;justify-content:space-between;font-size:11px;color:var(--ink-faint)">
      <span>Ticket #${idx} · Slot ${escapeHtml(slotLabel)} · <b style="color:var(--blue);font-family:'Geist Mono',monospace">${elapsedSec.toFixed(1)}s</b></span>
      <span>Est. human time: <b style="color:var(--ink)">~15 min</b></span>
    </div>`;
}

// ————————————————————————————————————————————————
// Reset
// ————————————————————————————————————————————————
function resetPanels() {
  for (let i = 0; i < NUM_SLOTS; i++) {
    const { dot, status, buglog } = slotEls(i);
    dot.className = 'status-dot';
    status.textContent = 'Idle';
    buglog.innerHTML = `
      <div class="agent-idle">
        <div class="agent-idle-icon"></div>
        <div>Awaiting input</div>
      </div>`;
  }
  orchDot.className = 'status-dot';
  orchStatus.textContent = 'Idle';
  orchBody.innerHTML = `
    <div class="orch-pending">
      Waiting for QA Agents to start<br>
      <span style="font-size:11px">Low severity bugs dismissed · rest get tickets</span>
    </div>`;
  runBtn.disabled = false;
  runBtn.textContent = 'Run 3 QA Agents →';
  runBtn.style.background = '';
}

// ————————————————————————————————————————————————
// Main flow
// ————————————————————————————————————————————————
async function run() {
  runBtn.disabled = true;
  runBtn.textContent = 'Running…';

  // Init slot panels
  for (let i = 0; i < NUM_SLOTS; i++) {
    const { dot, status, buglog } = slotEls(i);
    dot.className = 'status-dot active';
    status.textContent = 'Uploading…';
    buglog.innerHTML = `
      <div class="bug-log" id="buglog-inner-${i}">
        <div class="bug-log-status" id="bugscan-${i}">
          <span class="cursor"></span> Uploading clip…
        </div>
      </div>`;
  }

  // Init orchestrator
  orchDot.className = 'status-dot active';
  orchStatus.textContent = 'Waiting…';
  orchBody.innerHTML = `
    <div id="orch-waiting" style="color:var(--ink-faint);font-size:13px;padding:20px 0;text-align:center">
      Waiting for agents to flag bugs…
    </div>
    <div class="severity-columns" id="severity-columns" style="display:none">
      <div class="sev-col">
        <div class="sev-col-header">
          <span class="sev sev-critical">Critical</span>
          <span class="sev-col-count" id="col-count-critical">0</span>
        </div>
        <div class="sev-col-tickets" id="col-tickets-critical"></div>
      </div>
      <div class="sev-col">
        <div class="sev-col-header">
          <span class="sev sev-high">High</span>
          <span class="sev-col-count" id="col-count-high">0</span>
        </div>
        <div class="sev-col-tickets" id="col-tickets-high"></div>
      </div>
      <div class="sev-col">
        <div class="sev-col-header">
          <span class="sev sev-medium">Medium</span>
          <span class="sev-col-count" id="col-count-medium">0</span>
        </div>
        <div class="sev-col-tickets" id="col-tickets-medium"></div>
      </div>
    </div>`;

  // Shared state
  let ticketCount = 0;
  let ticketsCreated = 0;
  let dismissedCount = 0;
  const bugsPerSlot = [0, 0, 0];

  // Shared rate-limited orchestrator queue (13s gap = ≤4.6 calls/min)
  let orchCallChain = Promise.resolve();
  let lastOrchCallStart = 0;
  const ORCH_MIN_INTERVAL = 13000;

  function scheduleOrchCall(fn) {
    const promise = orchCallChain.then(async () => {
      const wait = Math.max(0, ORCH_MIN_INTERVAL - (Date.now() - lastOrchCallStart));
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      lastOrchCallStart = Date.now();
      return fn();
    });
    orchCallChain = promise.catch(() => {});
    return promise;
  }

  function sevToColKey(severity) {
    const s = (severity || '').toLowerCase();
    if (s === 'critical') return 'critical';
    if (s === 'high') return 'high';
    return 'medium';
  }

  function updateColCounts() {
    for (const key of ['critical', 'high', 'medium']) {
      const count = document.getElementById(`col-tickets-${key}`)?.children.length || 0;
      const el = document.getElementById(`col-count-${key}`);
      if (el) el.textContent = count;
    }
  }

  function updateOrchStatus() {
    const parts = [];
    if (ticketsCreated > 0) parts.push(`${ticketsCreated} ticket${ticketsCreated !== 1 ? 's' : ''} filed`);
    if (dismissedCount > 0) parts.push(`${dismissedCount} low dismissed`);
    if (parts.length) orchStatus.textContent = parts.join(' · ');
  }

  function getOrCreateDismissedSection() {
    let section = document.getElementById('dismissed-section');
    if (!section) {
      section = document.createElement('div');
      section.id = 'dismissed-section';
      section.className = 'dismissed-section';
      section.innerHTML = `
        <div class="dismissed-header">Low severity · dismissed <span id="dismissed-count">(0)</span></div>
        <div id="dismissed-list"></div>`;
      // Append after severity columns (or at end of orchBody)
      const cols = document.getElementById('severity-columns');
      cols ? cols.after(section) : orchBody.appendChild(section);
    }
    return section;
  }

  const allPromises = [];

  function handleBugFound(bug, slotIdx) {
    const slotLabel = SLOT_LABELS[slotIdx];
    bugsPerSlot[slotIdx]++;

    // Update slot bug log
    const inner = document.getElementById(`buglog-inner-${slotIdx}`);
    if (inner) {
      document.getElementById(`bugscan-${slotIdx}`)?.remove();
      const sevLower = (bug.severity || 'medium').toLowerCase();
      const line = document.createElement('div');
      line.className = 'bug-log-entry';
      line.innerHTML = `
        <span class="bug-log-bullet">BUG</span>
        <span class="bug-log-title">${escapeHtml(bug.title || 'Unknown')}</span>
        <span class="sev sev-${sevLower}">${escapeHtml(sevLower)}</span>
        <code class="bug-log-cat">${escapeHtml(bug.category || '')}</code>
        ${bug.timestamp ? `<span class="bug-log-ts">${escapeHtml(bug.timestamp)}</span>` : ''}`;
      inner.appendChild(line);
      // scroll bug log to latest
      const buglogEl = document.getElementById(`slot-buglog-${slotIdx}`);
      if (buglogEl) buglogEl.scrollTop = buglogEl.scrollHeight;
    }

    // Dismiss low severity
    if ((bug.severity || '').toLowerCase() === 'low') {
      dismissedCount++;
      getOrCreateDismissedSection();
      document.getElementById('dismissed-count').textContent = `(${dismissedCount})`;
      const list = document.getElementById('dismissed-list');
      if (list) {
        const entry = document.createElement('div');
        entry.className = 'dismissed-entry';
        entry.innerHTML = `
          <span class="dismissed-slot">Slot ${escapeHtml(slotLabel)}</span>
          <span>${escapeHtml(bug.title || 'Unknown')}</span>
          ${bug.timestamp ? `<span style="color:var(--ink-faint);font-family:'Geist Mono',monospace;font-size:10px">${escapeHtml(bug.timestamp)}</span>` : ''}`;
        list.appendChild(entry);
      }
      updateOrchStatus();
      return;
    }

    // Queue orchestrator call for non-low bugs
    document.getElementById('orch-waiting')?.remove();
    document.getElementById('severity-columns').style.display = '';
    orchDot.className = 'status-dot active';

    ticketCount++;
    const idx = ticketCount;
    const scenarioId = slotEls(slotIdx).select.value;

    // Place pending card in the column matching Gemini's severity
    const geminiColKey = sevToColKey(bug.severity);
    const wrapperEl = document.createElement('div');
    wrapperEl.id = `ticket-wrapper-${idx}`;
    wrapperEl.className = 'ticket-wrapper';
    wrapperEl.innerHTML = renderPendingCardHTML(idx, slotLabel, bug.title, bug.timestamp);
    document.getElementById(`col-tickets-${geminiColKey}`).appendChild(wrapperEl);

    const promise = scheduleOrchCall(async () => {
      const wrapper = document.getElementById(`ticket-wrapper-${idx}`);
      const statusEl = wrapper?.querySelector('.ticket-pending-status');
      if (statusEl) statusEl.textContent = 'Filing ticket…';
      orchStatus.textContent = `Filing ticket ${idx}…`;

      try {
        const t1 = performance.now();
        const bugReport = [
          bug.timestamp   && `Timestamp: ${bug.timestamp}`,
          bug.title       && `Title: ${bug.title}`,
          bug.description && `Description: ${bug.description}`,
          bug.severity    && `Severity: ${bug.severity}`,
          bug.category    && `Category: ${bug.category}`,
        ].filter(Boolean).join('\n');

        const ticket = await callOrchestrator(bugReport, scenarioId);
        const elapsed = (performance.now() - t1) / 1000;
        ticketsCreated++;

        // Move to correct column if orchestrator disagrees with Gemini's severity
        const orchColKey = sevToColKey(ticket.severity);
        const w = document.getElementById(`ticket-wrapper-${idx}`);
        if (w) {
          if (orchColKey !== geminiColKey) {
            document.getElementById(`col-tickets-${orchColKey}`).appendChild(w);
          }
          w.innerHTML = renderTicketHTML(ticket, elapsed, idx, slotLabel, bug.timestamp);
        }
        updateColCounts();
        updateOrchStatus();
        orchDot.className = 'status-dot done';
      } catch (err) {
        const w = document.getElementById(`ticket-wrapper-${idx}`);
        if (w) w.innerHTML = `<div class="error-msg">Ticket ${idx} (Slot ${escapeHtml(slotLabel)}) failed: ${escapeHtml(err.message)}</div>`;
      }
    });

    allPromises.push(promise);
  }

  const t0 = performance.now();

  // Run all 3 agents in parallel
  const agentPromises = Array.from({ length: NUM_SLOTS }, (_, i) => {
    const scenarioId = slotEls(i).select.value;
    const { dot, status } = slotEls(i);

    return callGeminiAgent(
      scenarioId,
      () => {
        status.textContent = 'Analyzing…';
        const scanEl = document.getElementById(`bugscan-${i}`);
        if (scanEl) scanEl.innerHTML = '<span class="cursor"></span> Scanning for bugs…';
      },
      (bug) => handleBugFound(bug, i)
    ).then(() => {
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      dot.className = 'status-dot done';
      status.textContent = `Done · ${bugsPerSlot[i]} bug${bugsPerSlot[i] !== 1 ? 's' : ''} · ${elapsed}s`;
      document.getElementById(`bugscan-${i}`)?.remove();
    }).catch((err) => {
      dot.className = 'status-dot error';
      status.textContent = 'Error';
      const inner = document.getElementById(`buglog-inner-${i}`);
      if (inner) inner.innerHTML = `<div class="error-msg">${escapeHtml(err.message)}</div>`;
    });
  });

  // Wait for all agents to finish streaming
  await Promise.allSettled(agentPromises);

  // Wait for all outstanding orchestrator calls
  await Promise.allSettled(allPromises);

  // Final status
  const totalBugs = bugsPerSlot.reduce((a, b) => a + b, 0);
  orchDot.className = 'status-dot done';
  updateOrchStatus();

  runBtn.textContent = `✓ Done · ${totalBugs} bugs · ${ticketsCreated} tickets`;
  runBtn.style.background = 'var(--green)';
  runBtn.disabled = false;
}

runBtn.addEventListener('click', run);
