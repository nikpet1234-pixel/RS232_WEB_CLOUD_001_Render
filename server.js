'use strict';

/*
  RS232_WEB_CLOUD / CLOUD_RELAY 001
  Read-only cloud receiver for RS232_WEB measurements.

  Routes:
    GET  /             - simple monitoring page
    POST /api/push     - ESP32 pushes one JSON measurement; token required
    GET  /api/latest   - latest measurement as JSON
    GET  /api/history  - last N measurements as JSON (RAM only)
    GET  /health       - health check

  Environment variables:
    PORT          - set automatically by Render
    DEVICE_TOKEN  - secret token required for POST /api/push
    VIEW_TOKEN    - optional token for viewing GET / and /api/latest
    HISTORY_LIMIT - optional; default 50, max 500
*/

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

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

function safeString(value, maxLen = 120) {
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

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(text);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeMeasurement(input) {
  const payload = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};

  return {
    received_at: nowIso(),
    device: safeString(payload.device || 'RS232_WEB', 40),
    version: safeString(payload.version, 20),
    no: safeString(payload.no, 40),
    article: safeString(payload.article, 120),
    u: safeString(payload.u, 40),
    i: safeString(payload.i, 40),
    p: safeString(payload.p, 40),
    freq: safeString(payload.freq, 40),
    time: safeString(payload.time, 40),
    status: safeString(payload.status || 'OK', 40)
  };
}

function statusObject() {
  return {
    ok: true,
    service: 'RS232_WEB_CLOUD / CLOUD_RELAY',
    version: '001-render-node',
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
  const initial = latest;

  const warning = USING_DEFAULT_DEVICE_TOKEN
    ? '<div class="warn">ВНИМАНИЕ: DEVICE_TOKEN е по подразбиране. За Render задай собствена Environment Variable DEVICE_TOKEN.</div>'
    : '';

  const viewWarn = VIEW_TOKEN
    ? '<div class="ok">VIEW_TOKEN е включен: страницата/JSON четенето са защитени с view token.</div>'
    : '<div class="note">Четенето е публично read-only. POST е защитен с DEVICE_TOKEN.</div>';

  return `<!doctype html>
<html lang="bg">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RS232_WEB Cloud Relay</title>
  <style>
    :root { font-family: Arial, Helvetica, sans-serif; color-scheme: light dark; }
    body { margin: 0; padding: 20px; background: #111827; color: #f9fafb; }
    .box { max-width: 920px; margin: 0 auto; background: #1f2937; border: 1px solid #374151; border-radius: 14px; padding: 18px; box-shadow: 0 8px 26px rgba(0,0,0,.25); }
    h1 { margin: 0 0 6px; font-size: 24px; }
    .sub { color: #cbd5e1; margin-bottom: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
    .card { background: #111827; border: 1px solid #374151; border-radius: 12px; padding: 14px; }
    .label { color: #9ca3af; font-size: 13px; margin-bottom: 5px; }
    .value { font-size: 26px; font-weight: 700; word-break: break-word; }
    .small .value { font-size: 18px; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; }
    td { border-bottom: 1px solid #374151; padding: 8px 4px; vertical-align: top; }
    td:first-child { color: #9ca3af; width: 170px; }
    .warn { background: #7c2d12; border: 1px solid #fdba74; color: #fff7ed; padding: 10px; border-radius: 10px; margin: 12px 0; }
    .note { background: #1e3a8a; border: 1px solid #93c5fd; padding: 10px; border-radius: 10px; margin: 12px 0; }
    .ok { background: #14532d; border: 1px solid #86efac; padding: 10px; border-radius: 10px; margin: 12px 0; }
    .muted { color: #9ca3af; font-size: 13px; }
    code { background: #0b1220; padding: 2px 5px; border-radius: 5px; }
    a { color: #93c5fd; }
  </style>
</head>
<body>
  <div class="box">
    <h1>RS232_WEB Cloud Relay</h1>
    <div class="sub">Read-only мониторинг. Няма дистанционни команди.</div>
    ${warning}
    ${viewWarn}

    <div id="empty" class="note" ${initial ? 'style="display:none"' : ''}>Още няма получено измерване.</div>

    <div class="grid">
      <div class="card"><div class="label">U</div><div class="value" id="u">-</div></div>
      <div class="card"><div class="label">I</div><div class="value" id="i">-</div></div>
      <div class="card"><div class="label">P</div><div class="value" id="p">-</div></div>
      <div class="card"><div class="label">Freq</div><div class="value" id="freq">-</div></div>
      <div class="card small"><div class="label">No</div><div class="value" id="no">-</div></div>
      <div class="card small"><div class="label">Article</div><div class="value" id="article">-</div></div>
      <div class="card small"><div class="label">Status</div><div class="value" id="status">-</div></div>
      <div class="card small"><div class="label">Received</div><div class="value" id="received_at">-</div></div>
    </div>

    <table>
      <tbody>
        <tr><td>Device</td><td id="device">-</td></tr>
        <tr><td>Firmware version</td><td id="version">-</td></tr>
        <tr><td>Device time</td><td id="time">-</td></tr>
        <tr><td>API latest</td><td><a href="/api/latest${authQuery}">/api/latest</a></td></tr>
        <tr><td>API history</td><td><a href="/api/history${authQuery}">/api/history</a></td></tr>
      </tbody>
    </table>

    <p class="muted">Страницата опреснява данните на всеки 2 секунди. Последните измервания се пазят само в RAM на cloud услугата.</p>
  </div>

<script>
const AUTH_QUERY = ${JSON.stringify(authQuery)};
function setText(id, value, suffix='') {
  document.getElementById(id).textContent = (value === undefined || value === null || value === '') ? '-' : String(value) + suffix;
}
function applyMeasurement(m) {
  const empty = document.getElementById('empty');
  if (!m) { empty.style.display = ''; return; }
  empty.style.display = 'none';
  setText('u', m.u, m.u ? ' V' : '');
  setText('i', m.i, m.i ? ' A' : '');
  setText('p', m.p, m.p ? ' W' : '');
  setText('freq', m.freq, m.freq ? ' Hz' : '');
  setText('no', m.no);
  setText('article', m.article);
  setText('status', m.status);
  setText('received_at', m.received_at);
  setText('device', m.device);
  setText('version', m.version);
  setText('time', m.time);
}
async function refresh() {
  try {
    const r = await fetch('/api/latest' + AUTH_QUERY, { cache: 'no-store' });
    const j = await r.json();
    if (j.ok && j.latest) applyMeasurement(j.latest);
  } catch (e) {}
}
applyMeasurement(${JSON.stringify(initial)});
setInterval(refresh, 2000);
refresh();
</script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    if (req.method === 'GET' && path === '/health') {
      return sendJson(res, 200, statusObject());
    }

    if (req.method === 'GET' && path === '/') {
      if (!isViewAuthorized(req, url)) return sendText(res, 401, 'Unauthorized');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end(htmlPage(url));
    }

    if (req.method === 'GET' && path === '/api/latest') {
      if (!isViewAuthorized(req, url)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return sendJson(res, 200, { ok: true, latest, status: statusObject() });
    }

    if (req.method === 'GET' && path === '/api/history') {
      if (!isViewAuthorized(req, url)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || HISTORY_LIMIT), 1), HISTORY_LIMIT);
      return sendJson(res, 200, { ok: true, count: Math.min(limit, history.length), history: history.slice(0, limit) });
    }

    if (req.method === 'POST' && path === '/api/push') {
      if (!isDeviceAuthorized(req, url)) {
        return sendJson(res, 401, { ok: false, error: 'bad_or_missing_device_token' });
      }

      let parsed;
      try {
        const raw = await readBody(req);
        parsed = raw ? JSON.parse(raw) : {};
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: 'invalid_json_or_payload_too_large' });
      }

      const measurement = normalizeMeasurement(parsed);
      latest = measurement;
      history.unshift(measurement);
      if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
      pushCount += 1;

      return sendJson(res, 200, {
        ok: true,
        stored: true,
        received_at: measurement.received_at,
        allow_remote_commands: 0
      });
    }

    // Explicitly keep command API disabled for this first stage.
    if (path.startsWith('/api/command') || path.startsWith('/api/remote')) {
      return sendJson(res, 403, { ok: false, error: 'remote_commands_disabled', allow_remote_commands: 0 });
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'server_error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`RS232_WEB_CLOUD relay listening on http://${HOST}:${PORT}`);
  if (USING_DEFAULT_DEVICE_TOKEN) {
    console.warn('WARNING: DEVICE_TOKEN is using the default dev value. Set a strong DEVICE_TOKEN in Render.');
  }
});
