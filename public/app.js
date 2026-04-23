/**
 * Atlantic QA Demo — frontend
 */

let SCENARIOS = [];
let currentScenario = null;

(async function init() {
  try {
    const res = await fetch('/api/scenarios');
    SCENARIOS = await res.json();
  } catch (err) {
    console.error('Failed to load scenarios:', err);
    return;
  }

  if (SCENARIOS.length === 0) {
    document.getElementById('header-title').textContent = 'No scenarios found';
    return;
  }

  const select = document.getElementById('scenario-select');
  for (const s of SCENARIOS) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.game ? `${s.game} — ${s.title}` : s.title || s.id;
    select.appendChild(opt);
  }

  select.addEventListener('change', () => loadScenario(select.value));
  await loadScenario(SCENARIOS[0].id);
})();

async function loadScenario(id) {
  currentScenario = SCENARIOS.find(s => s.id === id) || SCENARIOS[0];
  const s = currentScenario;

  const gameLabel = s.game ? `<b>${s.game}</b>` : id;
  document.getElementById('header-title').innerHTML = `${s.title || 'Bug analysis'} in ${gameLabel}`;
  document.getElementById('header-source').textContent = s.source ? `Source: ${s.source}` : '';
  const engineParts = [s.engine && `Engine: ${s.engine}`, s.platform && `Platform: ${s.platform}`].filter(Boolean);
  document.getElementById('header-engine').textContent = engineParts.join(' · ');
  document.getElementById('footer-credit').textContent = s.credit || '';
  document.title = `Atlantic · ${s.game || id}`;

  const player = document.getElementById('player');
  player.src = `/scenarios/${id}/clip.mp4`;
  player.load();

  const chips = [
    s.game     && `<span class="chip"><b>${s.game}</b></span>`,
    s.engine   && `<span class="chip">${s.engine}</span>`,
    s.platform && `<span class="chip">${s.platform}</span>`,
    ...(s.tags || []).map(t => `<span class="chip">${t}</span>`),
  ].filter(Boolean);
  document.getElementById('video-meta').innerHTML = chips.join('');
  document.getElementById('frame-count').textContent = s.duration ? `${s.duration}s` : '';

  resetPanels();
}

function resetPanels() {
  geminiDot.className = 'status-dot';
  geminiStatus.textContent = 'Idle';
  geminiBody.innerHTML = `
    <div class="agent-idle">
      <div class="agent-idle-icon"></div>
      <div>Awaiting video input</div>
      <div style="margin-top:4px;font-size:11px">Native video understanding · multi-bug detection</div>
    </div>`;

  orchDot.className = 'status-dot';
  orchStatus.textContent = 'Idle';
  orchBody.innerHTML = `
    <div class="orch-pending">
      Waiting for Gemini to flag bugs<br>
      <span style="font-size:11px">Tickets appear as issues are detected</span>
    </div>`;

  runBtn.disabled = false;
  runBtn.textContent = 'Run QA Analysis →';
  runBtn.style.background = '';
}

// ————————————————————————————————————————————————
// Utilities
// ————————————————————————————————————————————————
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ————————————————————————————————————————————————
// API
// ————————————————————————————————————————————————
async function callGeminiAgent(onChunk, onBugFound) {
  const response = await fetch('/api/gemini-agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario: currentScenario?.id }),
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
          onChunk(evt.delta.text);
        } else if (evt.type === 'bug_found' && evt.bug) {
          onBugFound(evt.bug);
        }
      } catch (_) { /* skip */ }
    }
  }
}

async function callOrchestrator(qaReport) {
  const response = await fetch('/api/orchestrator', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qa_report: qaReport, scenario: currentScenario?.id }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${response.status}: ${err.slice(0, 200)}`);
  }
  return response.json();
}

// ————————————————————————————————————————————————
// Rendering
// ————————————————————————————————————————————————
function renderPendingCardHTML(idx, bugTitle, bugTimestamp) {
  return `
    <div class="ticket-pending">
      <span class="status-dot active"></span>
      <div>
        <b>Bug #${idx}: ${escapeHtml(bugTitle || 'Detected issue')}</b>
        ${bugTimestamp ? `<span style="color:var(--ink-faint);font-size:11px;margin-left:6px">@ ${escapeHtml(bugTimestamp)}</span>` : ''}
        <div class="ticket-pending-status" style="font-size:11px;color:var(--ink-faint);margin-top:3px">Queued…</div>
      </div>
    </div>`;
}

function renderTicketHTML(t, elapsedSec, bugIdx, bugTimestamp) {
  const sevClass = `sev-${t.severity}`;
  const labelsHTML = (t.labels || []).map(l => `<span class="label-chip">${escapeHtml(l)}</span>`).join('');
  const steps = (t.repro_steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');

  return `
    <div class="ticket">
      <div class="ticket-header">
        <span class="ticket-id">${escapeHtml(t.ticket_id)}</span>
        <span class="ticket-system">Jira · auto-filed${bugTimestamp ? ` · ${escapeHtml(bugTimestamp)}` : ''}</span>
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
      <span>Bug #${bugIdx} · Orchestrated in <b style="color:var(--blue);font-family:'Geist Mono',monospace">${elapsedSec.toFixed(1)}s</b></span>
      <span>Est. human time: <b style="color:var(--ink)">~15 min</b></span>
    </div>`;
}

// ————————————————————————————————————————————————
// DOM refs
// ————————————————————————————————————————————————
const runBtn      = document.getElementById('run-btn');
const geminiBody  = document.getElementById('gemini-body');
const geminiDot   = document.getElementById('gemini-dot');
const geminiStatus = document.getElementById('gemini-status');
const orchBody    = document.getElementById('orch-body');
const orchDot     = document.getElementById('orch-dot');
const orchStatus  = document.getElementById('orch-status');

// ————————————————————————————————————————————————
// Main flow
// ————————————————————————————————————————————————
async function run() {
  runBtn.disabled = true;
  runBtn.textContent = 'Running…';

  geminiDot.className = 'status-dot active';
  geminiStatus.textContent = 'Uploading & processing…';
  geminiBody.innerHTML = `
    <div class="bug-log" id="gemini-output">
      <div class="bug-log-status" id="gemini-scan-status">
        <span class="cursor"></span> Uploading clip to Gemini File API…
      </div>
    </div>`;

  orchDot.className = 'status-dot active';
  orchStatus.textContent = 'Waiting…';
  orchBody.innerHTML = `
    <div class="orch-pending" id="orch-waiting">
      <div style="margin-bottom:8px">Waiting for Gemini to flag bugs…</div>
      <span style="font-size:11px">Tickets will appear as issues are detected</span>
    </div>`;

  let bugsFound = 0;
  let ticketsCreated = 0;
  const orchPromises = [];

  // Rate limiter: serialize calls, min 13s between starts (≤ 4.6/min, under the 5/min cap)
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

  const t0 = performance.now();

  function handleBugFound(bug) {
    bugsFound++;
    const idx = bugsFound;

    // Gemini panel: append compact one-liner
    const gOutput = document.getElementById('gemini-output');
    if (gOutput) {
      document.getElementById('gemini-scan-status')?.remove();
      const sevLower = (bug.severity || 'medium').toLowerCase();
      const line = document.createElement('div');
      line.className = 'bug-log-entry';
      line.innerHTML = `
        <span class="bug-log-bullet">BUG</span>
        <span class="bug-log-title">${escapeHtml(bug.title || 'Unknown')}</span>
        <span class="sev sev-${sevLower}">${escapeHtml(sevLower)}</span>
        <code class="bug-log-cat">${escapeHtml(bug.category || '')}</code>
        ${bug.timestamp ? `<span class="bug-log-ts">${escapeHtml(bug.timestamp)}</span>` : ''}`;
      gOutput.appendChild(line);
    }

    // Orchestrator panel: pending card
    document.getElementById('orch-waiting')?.remove();
    orchDot.className = 'status-dot active';

    const wrapperEl = document.createElement('div');
    wrapperEl.id = `ticket-wrapper-${idx}`;
    wrapperEl.className = 'ticket-wrapper';
    wrapperEl.innerHTML = renderPendingCardHTML(idx, bug.title, bug.timestamp);
    orchBody.appendChild(wrapperEl);
    orchBody.scrollTop = orchBody.scrollHeight;

    // Schedule orchestrator call (rate-limited, serialized)
    const promise = scheduleOrchCall(async () => {
      // Mark as actively filing
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

        const ticket = await callOrchestrator(bugReport);
        const elapsed = (performance.now() - t1) / 1000;
        ticketsCreated++;

        const w = document.getElementById(`ticket-wrapper-${idx}`);
        if (w) w.innerHTML = renderTicketHTML(ticket, elapsed, idx, bug.timestamp);

        orchStatus.textContent = `${ticketsCreated} ticket${ticketsCreated !== 1 ? 's' : ''} filed`;
        orchDot.className = 'status-dot done';
      } catch (err) {
        const w = document.getElementById(`ticket-wrapper-${idx}`);
        if (w) w.innerHTML = `<div class="error-msg">Ticket ${idx} failed: ${escapeHtml(err.message)}</div>`;
      }
    });

    orchPromises.push(promise);
  }

  try {
    await callGeminiAgent(
      () => {
        geminiStatus.textContent = 'Analyzing…';
        const scanStatus = document.getElementById('gemini-scan-status');
        if (scanStatus) scanStatus.innerHTML = '<span class="cursor"></span> Scanning for bugs…';
      },
      handleBugFound
    );
  } catch (err) {
    geminiDot.className = 'status-dot error';
    geminiStatus.textContent = 'Error';
    geminiBody.innerHTML = `<div class="error-msg">Gemini agent failed: ${escapeHtml(err.message)}</div>`;
    runBtn.disabled = false;
    runBtn.textContent = 'Retry';
    return;
  }

  const agentElapsed = (performance.now() - t0) / 1000;
  geminiDot.className = 'status-dot done';
  geminiStatus.textContent = `Complete · ${agentElapsed.toFixed(1)}s · ${bugsFound} bug${bugsFound !== 1 ? 's' : ''} flagged`;

  document.getElementById('gemini-scan-status')?.remove();

  const gOutput = document.getElementById('gemini-output');
  if (gOutput) {
    const timingDiv = document.createElement('div');
    timingDiv.className = 'agent-timing';
    timingDiv.innerHTML = `
      <div>
        <div class="big">${agentElapsed.toFixed(1)}s</div>
        <div style="font-size:10px;color:var(--ink-faint);letter-spacing:0.06em;text-transform:uppercase;margin-top:2px">agent runtime</div>
      </div>
      <div class="vs">full video · <b>${bugsFound} bug${bugsFound !== 1 ? 's' : ''} flagged</b><br>native understanding</div>`;
    gOutput.appendChild(timingDiv);
  }

  await Promise.allSettled(orchPromises);

  if (bugsFound === 0) {
    orchDot.className = 'status-dot done';
    orchStatus.textContent = 'No bugs detected';
    orchBody.innerHTML = `<div class="orch-pending">No bugs were flagged in this recording.</div>`;
  } else {
    orchDot.className = 'status-dot done';
    orchStatus.textContent = `${ticketsCreated} ticket${ticketsCreated !== 1 ? 's' : ''} filed`;
  }

  runBtn.textContent = '✓ Analysis complete';
  runBtn.style.background = 'var(--green)';
}

runBtn.addEventListener('click', run);
