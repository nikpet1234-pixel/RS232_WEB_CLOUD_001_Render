const express = require('express');
const path = require('path');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

const PORT = process.env.PORT || 10000;
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || '';
const VIEW_TOKEN = process.env.VIEW_TOKEN || '';
const HISTORY_LIMIT = Math.max(1, Math.min(Number(process.env.HISTORY_LIMIT || 100), 1000));
const ALLOW_REMOTE_COMMANDS = false;

let latest = null;
let history = [];
let pushCount = 0;
let bootTime = new Date().toISOString();

function nowIso() { return new Date().toISOString(); }
function clientIp(req) { return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim(); }
function tokenFromReq(req) {
  const auth = req.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return (req.get('x-device-token') || req.query.token || '').toString().trim();
}
function requireDeviceToken(req, res, next) {
  if (!DEVICE_TOKEN) return res.status(500).json({ ok:false, error:'DEVICE_TOKEN is not configured on server' });
  if (tokenFromReq(req) !== DEVICE_TOKEN) return res.status(401).json({ ok:false, error:'Unauthorized' });
  next();
}
function requireViewTokenIfSet(req, res, next) {
  if (!VIEW_TOKEN) return next();
  const got = (req.query.view_token || req.get('x-view-token') || '').toString().trim();
  if (got !== VIEW_TOKEN) return res.status(401).json({ ok:false, error:'VIEW_TOKEN required' });
  next();
}
function cleanValue(v, maxLen=80) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return v.slice(0, maxLen);
  return JSON.stringify(v).slice(0, maxLen);
}
function normalizePayload(body) {
  const b = body || {};
  const allowed = ['device','version','no','article','u','i','p','freq','time','status','u1','u2','u3','i1','i2','i3','p1','p2','p3','uavg','iavg','psum','h1','h2','h3','activePhases','uMode','source'];
  const out = {};
  for (const k of allowed) if (Object.prototype.hasOwnProperty.call(b,k)) out[k] = cleanValue(b[k]);
  if (!out.device) out.device = 'RS232_WEB';
  if (!out.version) out.version = '108';
  if (!out.time) out.time = new Date().toLocaleString('sv-SE').replace('T',' ');
  out.received_at = nowIso();
  out.remote_ip = clientIp({ headers:{}, socket:{} });
  return out;
}

app.get('/', requireViewTokenIfSet, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/push', requireDeviceToken, (req, res) => {
  const item = normalizePayload(req.body);
  item.remote_ip = clientIp(req);
  latest = item;
  history.push(item);
  pushCount += 1;
  while (history.length > HISTORY_LIMIT) history.shift();
  res.json({ ok:true, stored:true, push_count: pushCount, history_count: history.length, latest: item });
});

app.get('/api/latest', requireViewTokenIfSet, (req, res) => {
  res.json({ ok:true, latest, history_count: history.length, push_count: pushCount, allow_remote_commands: 0 });
});

app.get('/api/history', requireViewTokenIfSet, (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || HISTORY_LIMIT), HISTORY_LIMIT));
  res.json({ ok:true, history: history.slice(-limit), history_count: history.length, limit, allow_remote_commands: 0 });
});

app.get('/health', (req, res) => {
  res.json({
    ok:true,
    service:'RS232_WEB_CLOUD_003_Render_RS232_UI',
    boot_time: bootTime,
    now: nowIso(),
    has_latest: !!latest,
    push_count: pushCount,
    history_count: history.length,
    history_limit: HISTORY_LIMIT,
    post_protected: !!DEVICE_TOKEN,
    view_protected: !!VIEW_TOKEN,
    allow_remote_commands: 0
  });
});

function forbidden(req, res) {
  res.status(403).json({ ok:false, error:'Forbidden in cloud read-only mode', allow_remote_commands: 0 });
}
['/api/read','/api/loop','/api/hold','/api/command','/api/settings','/api/set','/api/status','/api/measurement','/api/log','/api/addlog','/api/clearrows','/api/print','/api/printrow','/api/printlog','/api/printertest','/api/soundtest','/api/console','/api/profile','/api/detect','/api/baud','/api/sd/list','/api/sd/download','/api/sd/downloadfile','/api/fft/read','/api/fft/csv','/api/fft/sd','/sdtools','/diag','/embedded'].forEach(route => {
  app.all(route, forbidden);
});

app.use((req, res) => res.status(404).json({ ok:false, error:'Not found' }));

app.listen(PORT, () => {
  console.log(`RS232_WEB_CLOUD_003_Render_RS232_UI listening on ${PORT}`);
});
