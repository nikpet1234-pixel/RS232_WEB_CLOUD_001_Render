'use strict';

/*
  RS232_WEB_CLOUD / CLOUD_RELAY 002 - Render Main UI
  Read-only cloud receiver for RS232_WEB measurements.

  IMPORTANT:
  - This service DOES NOT expose the local ESP32 RS232_WEB menu.
  - This service DOES NOT provide remote commands.
  - POST /api/push is protected with DEVICE_TOKEN.
  - GET pages can be public read-only, or optionally protected with VIEW_TOKEN.
  - History is RAM-only for this test stage.

  Routes:
    GET  /             - Main-style monitoring page
    POST /api/push     - ESP32/computer pushes one JSON measurement; DEVICE_TOKEN required
    GET  /api/latest   - latest measurement as JSON
    GET  /api/history  - last N measurements as JSON (RAM only)
    GET  /health       - health check

  Environment variables:
    PORT          - set automatically by Render
    DEVICE_TOKEN  - secret token required for POST /api/push
    VIEW_TOKEN    - optional token for viewing GET / and read JSON endpoints
    HISTORY_LIMIT - optional; default 50, max 500
*/

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

const SERVICE_VERSION = '002-render-mainui';
const DEFAULT_DEVICE_TOKEN = 'change-me-dev-token';
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || DEFAULT_DEVICE_TOKEN;
const USING_DEFAULT_DEVICE_TOKEN = DEVICE_TOKEN === DEFAULT_DEVICE_TOKEN;

// If VIEW_TOKEN is empty, the monitoring page and JSON read endpoints are public read-only.
const VIEW_TOKEN = process.env.VIEW_TOKEN || '';

const parsedHistoryLimit = Number(process.env.HISTORY_LIMIT || 50);
const HISTORY_LIMIT = Math.min(Math.max(Number.isFinite(parsedHistoryLimit) ? parsedHistoryLimit : 50, 1), 500);

let latest = null;
let history = [];
let pushCount = 0;
let lastBadTokenAt = null;

function nowIso() {
  return new Date().toISOString();
}

function safeString(value, maxLen = 160) {
  if (value === undefined || value === null) return '';
  return String(value).slice(0, maxLen);
}

function timingSafeEqualString(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function getRequestToken(req, url, headerName, queryName) {
  return (
    getBearerToken(req) ||
    safeString(req.headers[headerName], 500) ||
    safeString(url.searchParams.get(queryName), 500)
  );
}

function isDeviceAuthorized(req, url) {
  const token = getRequestToken(req, url, 'x-device-token', 'token');
  const ok = timingSafeEqualString(token, DEVICE_TOKEN);
  if (!ok) lastBadTokenAt = nowIso();
  return ok;
}

function isViewAuthorized(req, url) {
  if (!VIEW_TOKEN) return true;
  const token = getRequestToken(req, url, 'x-view-token', 'view_token');
  return timingSafeEqualString(token, VIEW_TOKEN);
}

function readBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      data += chunk;
      if (data.length > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(html);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(text);
}

function normalizeMeasurement(input) {
  const payload = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};

  return {
    received_at: nowIso(),
    device: safeString(payload.device || 'RS232_WEB', 40),
    version: safeString(payload.version, 24),
    no: safeString(payload.no, 40),
    article: safeString(payload.article, 160),
    u: safeString(payload.u, 40),
    i: safeString(payload.i, 40),
    p: safeString(payload.p, 40),
    freq: safeString(payload.freq, 40),
    time: safeString(payload.time, 60),
    status: safeString(payload.status || 'OK', 40)
  };
}

function statusObject() {
  return {
    ok: true,
    service: 'RS232_WEB_CLOUD / CLOUD_RELAY',
    version: SERVICE_VERSION,
    mode: 'read-only',
    allow_remote_commands: 0,
    push_count: pushCount,
    has_latest: !!latest,
    history_count: history.length,
    history_limit: HISTORY_LIMIT,
    view_protected: !!VIEW_TOKEN,
    using_default_device_token: USING_DEFAULT_DEVICE_TOKEN,
    last_bad_token_at: lastBadTokenAt
  };
}

function htmlPage(url) {
  const viewToken = safeString(url.searchParams.get('view_token'), 500);
  const authQuery = viewToken ? `?view_token=${encodeURIComponent(viewToken)}` : '';

  const tokenWarning = USING_DEFAULT_DEVICE_TOKEN
    ? '<div class="warn">ВНИМАНИЕ: DEVICE_TOKEN е по подразбиране. За Render задай собствена Environment Variable DEVICE_TOKEN.</div>'
    : '';

  const viewNotice = VIEW_TOKEN
    ? '<span class="badge good">VIEW: protected</span>'
    : '<span class="badge blue">VIEW: public read-only</span>';

  return `<!doctype html>
<html lang="bg">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RS232_WEB Cloud Main</title>
  <style>
    :root {
      --bg: #0d1117;
      --panel: #161b22;
      --panel2: #0f172a;
      --line: #30363d;
      --text: #f0f6fc;
      --muted: #9aa7b4;
      --accent: #58a6ff;
      --ok: #3fb950;
      --warn: #d29922;
      --bad: #f85149;
      --btn: #21262d;
      --btn2: #2d333b;
      --disabled: #444c56;
      --shadow: rgba(0,0,0,.35);
      color-scheme: dark;
      font-family: Arial, Helvetica, sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); }
    .wrap { max-width: 1180px; margin: 0 auto; padding: 14px; }
    .topbar {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      background: linear-gradient(180deg, #1f2937, #111827);
      border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px;
      box-shadow: 0 10px 30px var(--shadow);
    }
    .title { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .title h1 { font-size: 20px; margin:0; letter-spacing:.3px; }
    .subtitle { color: var(--muted); font-size: 12px; margin-top: 3px; }
    .badge { display:inline-block; border: 1px solid var(--line); border-radius: 999px; padding: 4px 9px; font-size: 12px; color: var(--muted); }
    .badge.good { color: #b6f0c2; border-color: #2ea043; background:#0f2a18; }
    .badge.blue { color:#c9e1ff; border-color:#1f6feb; background:#0b1d35; }
    .badge.warn { color:#ffe6a3; border-color:#9e6a03; background:#2a1f05; }
    .badge.bad { color:#ffd2cf; border-color:#da3633; background:#2d1111; }
    .toolbar { display:flex; gap:8px; flex-wrap:wrap; margin: 12px 0; }
    button {
      border: 1px solid var(--line); background: var(--btn); color: var(--text);
      border-radius: 10px; padding: 9px 12px; font-weight: 700; cursor: pointer;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
    }
    button:hover { background: var(--btn2); }
    button.primary { border-color:#1f6feb; background:#0b3b73; }
    button.ok { border-color:#2ea043; background:#12351e; }
    button.warn { border-color:#9e6a03; background:#3a2b07; }
    button.danger { border-color:#da3633; background:#3a1414; }
    button.locked { color: #b8c0cc; background: #22272e; border-style: dashed; }
    button.active { outline: 2px solid var(--warn); }
    .main { display:grid; grid-template-columns: 1.1fr .9fr; gap: 12px; }
    .panel { background: var(--panel); border:1px solid var(--line); border-radius:14px; padding:14px; box-shadow: 0 8px 20px var(--shadow); }
    .panel h2 { margin:0 0 10px; font-size: 15px; color:#dbeafe; }
    .readout { display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; }
    .meter { background: var(--panel2); border:1px solid var(--line); border-radius:14px; padding:14px; min-height:96px; }
    .meter .label { color: var(--muted); font-size:13px; margin-bottom: 4px; }
    .meter .value { font-size: 34px; line-height: 1.05; font-weight: 800; word-break: break-word; }
    .meter .unit { color: var(--muted); font-size:15px; margin-top: 4px; }
    .meta { display:grid; grid-template-columns: 120px 1fr; gap: 8px 10px; align-items:center; }
    .meta .k { color: var(--muted); }
    .meta .v { background: var(--panel2); border:1px solid var(--line); padding:8px 10px; border-radius:9px; min-height:34px; word-break: break-word; }
    .logbar { display:flex; justify-content:space-between; align-items:center; gap:8px; margin: 12px 0 8px; }
    .tablebox { overflow:auto; border:1px solid var(--line); border-radius:12px; }
    table { width:100%; border-collapse:collapse; min-width: 840px; }
    th, td { border-bottom:1px solid var(--line); padding:8px 9px; text-align:left; font-size: 13px; white-space: nowrap; }
    th { background:#111827; color:#dbeafe; position: sticky; top: 0; }
    tr:hover td { background:#111827; }
    .status-ok { color: #7ee787; font-weight: 700; }
    .status-bad { color: #ff9b95; font-weight: 700; }
    .muted { color: var(--muted); }
    .warn { background: #3a2b07; border: 1px solid #9e6a03; color: #ffe6a3; padding: 10px; border-radius: 10px; margin: 12px 0; }
    .note { background: #0b1d35; border: 1px solid #1f6feb; color: #c9e1ff; padding: 10px; border-radius: 10px; margin: 12px 0; }
    .disabled-panel { opacity:.75; }
    .footer { color:var(--muted); font-size:12px; margin-top:12px; }
    a { color:#93c5fd; }
    @media (max-width: 800px) {
      .main { grid-template-columns: 1fr; }
      .readout { grid-template-columns: 1fr; }
      .meter .value { font-size: 30px; }
    }
    @media print {
      body { background:#fff; color:#000; }
      .toolbar, .footer, .note, .warn { display:none !important; }
      .topbar, .panel { box-shadow:none; border-color:#888; background:#fff; color:#000; }
      .meter, .meta .v { background:#fff; border-color:#999; }
      .badge { color:#000; border-color:#999; }
      th, td { color:#000; border-color:#bbb; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div>
        <div class="title">
          <h1>RS232_WEB CLOUD MAIN</h1>
          <span class="badge good">read-only</span>
          <span class="badge bad">remote commands OFF</span>
          ${viewNotice}
        </div>
        <div class="subtitle">Cloud мониторинг за RS232_WEB. Това не е tunnel към ESP32.</div>
      </div>
      <div class="muted" id="cloudClock">-</div>
    </div>

    ${tokenWarning}

    <div class="toolbar" aria-label="Main buttons">
      <button class="primary" id="btnRead">READ / REFRESH</button>
      <button class="ok" id="btnAdd">ADD</button>
      <button class="warn" id="btnHold">HOLD</button>
      <button id="btnNoMinus">NO-</button>
      <button id="btnNoPlus">NO+</button>
      <button id="btnExport">EXPORT CSV</button>
      <button id="btnPrint">PRINT</button>
      <button class="danger" id="btnClear">CLEAR LOCAL</button>
      <button class="locked" data-locked="REMOTE LOOP START">LOOP START</button>
      <button class="locked" data-locked="REMOTE LOOP STOP">LOOP STOP</button>
      <button class="locked" data-locked="REMOTE SETTINGS">SETTINGS</button>
    </div>

    <div class="note" id="message">Готово. Страницата обновява последните cloud данни автоматично.</div>

    <div class="main">
      <section class="panel">
        <h2>Основно измерване</h2>
        <div class="readout">
          <div class="meter"><div class="label">Voltage U</div><div class="value" id="u">-</div><div class="unit">V</div></div>
          <div class="meter"><div class="label">Current I</div><div class="value" id="i">-</div><div class="unit">A</div></div>
          <div class="meter"><div class="label">Power P</div><div class="value" id="p">-</div><div class="unit">W</div></div>
        </div>
        <div style="height:10px"></div>
        <div class="readout">
          <div class="meter"><div class="label">Frequency</div><div class="value" id="freq">-</div><div class="unit">Hz</div></div>
          <div class="meter"><div class="label">Status</div><div class="value" id="status">-</div><div class="unit">status</div></div>
          <div class="meter"><div class="label">Received</div><div class="value" id="receivedShort">-</div><div class="unit">cloud time</div></div>
        </div>
      </section>

      <section class="panel">
        <h2>Данни за реда</h2>
        <div class="meta">
          <div class="k">Device</div><div class="v" id="device">-</div>
          <div class="k">Version</div><div class="v" id="version">-</div>
          <div class="k">No</div><div class="v" id="no">-</div>
          <div class="k">Article</div><div class="v" id="article">-</div>
          <div class="k">Device time</div><div class="v" id="time">-</div>
          <div class="k">Received at</div><div class="v" id="received_at">-</div>
        </div>
        <div class="footer">
          API: <a href="/api/latest${authQuery}">/api/latest</a> · <a href="/api/history${authQuery}">/api/history</a> · <a href="/health">/health</a>
        </div>
      </section>
    </div>

    <section class="panel" style="margin-top:12px">
      <div class="logbar">
        <h2 style="margin:0">Cloud history / Local table</h2>
        <span class="muted" id="historyInfo">-</span>
      </div>
      <div class="tablebox">
        <table id="historyTable">
          <thead>
            <tr>
              <th>#</th>
              <th>No</th>
              <th>Article</th>
              <th>U</th>
              <th>I</th>
              <th>P</th>
              <th>Freq</th>
              <th>Status</th>
              <th>Device time</th>
              <th>Received</th>
            </tr>
          </thead>
          <tbody id="historyBody">
            <tr><td colspan="10" class="muted">Още няма данни.</td></tr>
          </tbody>
        </table>
      </div>
      <div class="footer">ADD добавя текущото последно измерване само в локалната таблица на браузъра. CLEAR LOCAL чисти само локалния изглед, не cloud историята.</div>
    </section>
  </div>

<script>
const AUTH_QUERY = ${JSON.stringify(authQuery)};
let latest = null;
let history = [];
let localRows = [];
let hold = false;
let localNoOverride = null;

function pad2(n) { return String(n).padStart(2, '0'); }
function clockText(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}
function showMessage(text, kind='note') {
  const el = document.getElementById('message');
  el.textContent = text;
  el.className = kind === 'warn' ? 'warn' : 'note';
}
function setText(id, value) {
  document.getElementById(id).textContent = (value === undefined || value === null || value === '') ? '-' : String(value);
}
function shortTime(value) {
  if (!value) return '-';
  const s = String(value);
  const t = s.match(/T(\d\d:\d\d:\d\d)/);
  if (t) return t[1];
  const m = s.match(/(\d\d:\d\d:\d\d)/);
  return m ? m[1] : s;
}
function copyMeasurement(m) {
  return m ? JSON.parse(JSON.stringify(m)) : null;
}
function displayedNo() {
  if (localNoOverride !== null) return String(localNoOverride).padStart(6, '0');
  return latest && latest.no ? latest.no : '';
}
function applyMeasurement(m) {
  latest = m || latest;
  if (!m) return;
  setText('u', m.u);
  setText('i', m.i);
  setText('p', m.p);
  setText('freq', m.freq);
  setText('status', m.status);
  setText('receivedShort', shortTime(m.received_at));
  setText('device', m.device);
  setText('version', m.version);
  setText('no', displayedNo());
  setText('article', m.article);
  setText('time', m.time);
  setText('received_at', m.received_at);
  const st = document.getElementById('status');
  st.className = 'value ' + (String(m.status || '').toUpperCase() === 'OK' ? 'status-ok' : 'status-bad');
}
function allRowsForDisplay() {
  if (localRows.length) return localRows;
  return history;
}
function renderHistory() {
  const body = document.getElementById('historyBody');
  const rows = allRowsForDisplay();
  document.getElementById('historyInfo').textContent = localRows.length ? ('local rows: ' + localRows.length) : ('cloud rows: ' + history.length);
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="10" class="muted">Още няма данни.</td></tr>';
    return;
  }
  body.innerHTML = '';
  rows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    const cells = [
      String(idx + 1), r.no || '', r.article || '', r.u || '', r.i || '', r.p || '', r.freq || '', r.status || '', r.time || '', r.received_at || ''
    ];
    cells.forEach((c, ci) => {
      const td = document.createElement('td');
      td.textContent = c || '-';
      if (ci === 7) td.className = String(c).toUpperCase() === 'OK' ? 'status-ok' : 'status-bad';
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}
async function fetchJson(path) {
  const res = await fetch(path + AUTH_QUERY, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
async function refreshLatest(manual=false) {
  if (hold && !manual) return;
  try {
    const data = await fetchJson('/api/latest');
    if (data.latest) {
      applyMeasurement(data.latest);
      if (manual) showMessage('READ/REFRESH: последното cloud измерване е заредено.');
    } else if (manual) {
      showMessage('Още няма получено измерване.', 'warn');
    }
  } catch (err) {
    showMessage('Грешка при /api/latest: ' + err.message, 'warn');
  }
}
async function refreshHistory() {
  if (hold) return;
  try {
    const data = await fetchJson('/api/history');
    history = Array.isArray(data.history) ? data.history : [];
    if (!localRows.length) renderHistory();
  } catch (err) {
    // Keep UI calm; latest error is enough for normal operation.
  }
}
function addLocalRow() {
  if (!latest) { showMessage('Няма текущо измерване за ADD.', 'warn'); return; }
  const row = copyMeasurement(latest);
  row.no = displayedNo();
  localRows.unshift(row);
  renderHistory();
  showMessage('ADD: текущото измерване е добавено в локалната таблица.');
}
function changeNo(delta) {
  const src = displayedNo() || '0';
  const n = Number(String(src).replace(/\D/g, '') || '0');
  localNoOverride = Math.max(0, n + delta);
  setText('no', displayedNo());
  showMessage('NO е променен само визуално/локално: ' + displayedNo());
}
function clearLocal() {
  localRows = [];
  localNoOverride = null;
  renderHistory();
  if (latest) applyMeasurement(latest);
  showMessage('CLEAR LOCAL: изчистен е само локалният изглед. Cloud историята не е изтрита.');
}
function csvEscape(v) {
  const s = String(v === undefined || v === null ? '' : v);
  return '"' + s.replaceAll('"', '""') + '"';
}
function exportCsv() {
  const rows = allRowsForDisplay();
  if (!rows.length) { showMessage('Няма редове за Export CSV.', 'warn'); return; }
  const header = ['idx','no','article','u','i','p','freq','status','device_time','received_at'];
  const lines = ['sep=,', header.join(',')];
  rows.forEach((r, idx) => {
    lines.push([
      idx + 1, r.no || '', r.article || '', r.u || '', r.i || '', r.p || '', r.freq || '', r.status || '', r.time || '', r.received_at || ''
    ].map(csvEscape).join(','));
  });
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'rs232_web_cloud_history.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  showMessage('EXPORT CSV: файлът е подготвен от текущата таблица.');
}
function lockedCommand(name) {
  showMessage(name + ': дистанционните команди са изключени. allow_remote_commands=0', 'warn');
}
function updateClock() {
  document.getElementById('cloudClock').textContent = clockText(new Date());
}

document.getElementById('btnRead').addEventListener('click', () => refreshLatest(true));
document.getElementById('btnAdd').addEventListener('click', addLocalRow);
document.getElementById('btnHold').addEventListener('click', () => {
  hold = !hold;
  const b = document.getElementById('btnHold');
  b.textContent = hold ? 'UNHOLD' : 'HOLD';
  b.classList.toggle('active', hold);
  showMessage(hold ? 'HOLD: автоматичното обновяване е спряно.' : 'UNHOLD: автоматичното обновяване е включено.');
});
document.getElementById('btnNoMinus').addEventListener('click', () => changeNo(-1));
document.getElementById('btnNoPlus').addEventListener('click', () => changeNo(1));
document.getElementById('btnClear').addEventListener('click', clearLocal);
document.getElementById('btnExport').addEventListener('click', exportCsv);
document.getElementById('btnPrint').addEventListener('click', () => window.print());
document.querySelectorAll('[data-locked]').forEach(btn => btn.addEventListener('click', () => lockedCommand(btn.dataset.locked)));

updateClock();
setInterval(updateClock, 1000);
refreshLatest(true);
refreshHistory();
setInterval(refreshLatest, 2000);
setInterval(refreshHistory, 5000);
</script>
</body>
</html>`;
}

async function handlePostPush(req, res, url) {
  if (!isDeviceAuthorized(req, url)) {
    return sendJson(res, 401, { ok: false, error: 'Unauthorized: missing or invalid DEVICE_TOKEN' });
  }

  let raw;
  try {
    raw = await readBody(req);
  } catch (err) {
    return sendJson(res, 413, { ok: false, error: err.message });
  }

  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
  }

  const measurement = normalizeMeasurement(parsed);
  latest = measurement;
  history.unshift(measurement);
  history = history.slice(0, HISTORY_LIMIT);
  pushCount += 1;

  return sendJson(res, 200, {
    ok: true,
    stored: true,
    mode: 'read-only',
    allow_remote_commands: 0,
    push_count: pushCount,
    latest: measurement
  });
}

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Token, X-View-Token',
      'Access-Control-Max-Age': '600'
    });
    return res.end();
  }

  if (req.method === 'GET' && path === '/health') {
    return sendJson(res, 200, statusObject());
  }

  if (req.method === 'GET' && path === '/') {
    if (!isViewAuthorized(req, url)) {
      return sendHtml(res, 401, '<!doctype html><meta charset="utf-8"><title>Unauthorized</title><h1>Unauthorized</h1><p>VIEW_TOKEN is required.</p>');
    }
    return sendHtml(res, 200, htmlPage(url));
  }

  if (req.method === 'GET' && path === '/api/latest') {
    if (!isViewAuthorized(req, url)) {
      return sendJson(res, 401, { ok: false, error: 'Unauthorized: VIEW_TOKEN required' });
    }
    return sendJson(res, 200, {
      ok: true,
      mode: 'read-only',
      allow_remote_commands: 0,
      latest
    });
  }

  if (req.method === 'GET' && path === '/api/history') {
    if (!isViewAuthorized(req, url)) {
      return sendJson(res, 401, { ok: false, error: 'Unauthorized: VIEW_TOKEN required' });
    }
    return sendJson(res, 200, {
      ok: true,
      mode: 'read-only',
      allow_remote_commands: 0,
      count: history.length,
      history
    });
  }

  if (req.method === 'POST' && path === '/api/push') {
    return handlePostPush(req, res, url);
  }

  if (path === '/api/read' || path === '/api/loop' || path === '/api/command' || path === '/api/settings' || path === '/sdtools') {
    return sendJson(res, 403, {
      ok: false,
      error: 'Remote commands and local device tools are disabled in cloud relay',
      allow_remote_commands: 0
    });
  }

  return sendText(res, 404, 'Not found');
}

const server = http.createServer((req, res) => {
  router(req, res).catch(err => {
    console.error(err);
    sendJson(res, 500, { ok: false, error: 'Internal server error' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`RS232_WEB_CLOUD ${SERVICE_VERSION} listening on http://${HOST}:${PORT}`);
});
