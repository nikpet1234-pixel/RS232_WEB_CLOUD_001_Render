const express = require('express');
const path = require('path');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

const PORT = process.env.PORT || 10000;
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || '';
const VIEW_TOKEN = process.env.VIEW_TOKEN || '';
const HISTORY_LIMIT = Math.max(1, Math.min(Number(process.env.HISTORY_LIMIT || 100), 1000));
const ALLOW_REMOTE_COMMANDS = false; // CLOUD_004 remains read-only by design.

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
function cleanValue(v, maxLen=120) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return v.slice(0, maxLen);
  return JSON.stringify(v).slice(0, maxLen);
}
function cleanObj(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const [k,v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = cleanObj(v);
    else out[k] = cleanValue(v);
  }
  return out;
}
function firstDefined(source, keys) {
  for (const k of keys) {
    if (source && Object.prototype.hasOwnProperty.call(source, k) && source[k] !== undefined && source[k] !== null && source[k] !== '') return source[k];
  }
  return '';
}
function nestedPhase(b, phase, field, aliases=[]) {
  const p = b[phase] || b[phase.toUpperCase()] || {};
  const flatKeys = [phase + '_' + field, phase.toUpperCase() + '_' + field, phase + field, phase.toUpperCase() + field].concat(aliases);
  const nestedKeys = [field, field.toUpperCase()];
  return firstDefined(p, nestedKeys) || firstDefined(b, flatKeys);
}
function normalizePayload(body, req) {
  const b = body || {};
  const out = {
    schema: cleanValue(b.schema || b.state_schema || 'rs232_web_cloud_state_v1'),
    device: cleanValue(firstDefined(b, ['device','deviceName','type']) || 'RS232_WEB'),
    version: cleanValue(firstDefined(b, ['version','fw','firmware']) || '108'),
    no: cleanValue(firstDefined(b, ['no','serial','number'])),
    next_no: cleanValue(firstDefined(b, ['next_no','nextNo','nextno'])),
    article: cleanValue(firstDefined(b, ['article','art'])),
    time: cleanValue(firstDefined(b, ['time','timestamp','datetime']) || new Date().toLocaleString('sv-SE').replace('T',' ')),
    status: cleanValue(firstDefined(b, ['status','state']) || 'OK'),
    freq: cleanValue(firstDefined(b, ['freq','frequency','freqHz','hz'])),

    u1: cleanValue(nestedPhase(b, 'l1', 'u', ['u1','U1'])),
    u2: cleanValue(nestedPhase(b, 'l2', 'u', ['u2','U2'])),
    u3: cleanValue(nestedPhase(b, 'l3', 'u', ['u3','U3'])),
    i1: cleanValue(nestedPhase(b, 'l1', 'i', ['i1','I1'])),
    i2: cleanValue(nestedPhase(b, 'l2', 'i', ['i2','I2'])),
    i3: cleanValue(nestedPhase(b, 'l3', 'i', ['i3','I3'])),
    p1: cleanValue(nestedPhase(b, 'l1', 'p', ['p1','P1'])),
    p2: cleanValue(nestedPhase(b, 'l2', 'p', ['p2','P2'])),
    p3: cleanValue(nestedPhase(b, 'l3', 'p', ['p3','P3'])),
    h1: cleanValue(nestedPhase(b, 'l1', 'h', ['h1','H1','l1_l','L1_L']) || nestedPhase(b, 'l1', 'l', ['l1','L1'])),
    h2: cleanValue(nestedPhase(b, 'l2', 'h', ['h2','H2','l2_l','L2_L']) || nestedPhase(b, 'l2', 'l', ['l2','L2'])),
    h3: cleanValue(nestedPhase(b, 'l3', 'h', ['h3','H3','l3_l','L3_L']) || nestedPhase(b, 'l3', 'l', ['l3','L3'])),

    // Aggregates are accepted from the device. CLOUD_004 does not calculate them when missing.
    uavg: cleanValue(firstDefined(b, ['uavr','uavr_phase','uavg','u_avg','u_average','u','U','voltage'])),
    iavg: cleanValue(firstDefined(b, ['iavr','iavg','i_avg','i_average','i','I','current'])),
    psum: cleanValue(firstDefined(b, ['psum','p_sum','ptotal','p_total','p','P','power'])),

    activePhases: cleanValue(firstDefined(b, ['activePhases','active_phases','phases']) || 'L1,L2,L3'),
    uMode: cleanValue(firstDefined(b, ['uMode','u_mode','uDisplayMode']) || 'phase'),
    source: cleanValue(firstDefined(b, ['source']) || 'cloud'),

    trigger_enabled: cleanValue(firstDefined(b, ['trigger_enabled','triggerEnabled','trig_enabled','trigEnabled'])),
    trigger_parameter: cleanValue(firstDefined(b, ['trigger_parameter','triggerParameter','trig_param','trigParam','selection','izbor'])),
    trigger_by: cleanValue(firstDefined(b, ['trigger_by','triggerBy','trig_by','trigBy'])),
    trigger_threshold: cleanValue(firstDefined(b, ['trigger_threshold','triggerThreshold','target'])),
    trigger_tolerance_pct: cleanValue(firstDefined(b, ['trigger_tolerance_pct','triggerTolerancePct','tolPct','tolerance_pct'])),
    trigger_mode: cleanValue(firstDefined(b, ['trigger_mode','triggerMode','mode'])),
    trigger_value: cleanValue(firstDefined(b, ['trigger_value','triggerValue','trigVal'])),
    trigger_state: cleanValue(firstDefined(b, ['trigger_state','triggerState','triggerStatus','trigStatus'])),
    trigger_hit: cleanValue(firstDefined(b, ['trigger_hit','triggerHit','trigHit'])),
    autostop: cleanValue(firstDefined(b, ['autostop','autoStop'])),

    hold: cleanValue(firstDefined(b, ['hold','hold_state','holdState'])),
    loop_running: cleanValue(firstDefined(b, ['loop_running','loopRunning','loop','loop_state'])),
    verified: cleanValue(firstDefined(b, ['verified','verify','verify_ok'])),

    allow_remote_commands: 0,
    received_at: nowIso(),
    remote_ip: req ? clientIp(req) : '',
    raw_state: cleanObj(b)
  };
  if (!out.next_no && out.no) out.next_no = out.no;
  return out;
}

app.get('/', requireViewTokenIfSet, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/push', requireDeviceToken, (req, res) => {
  const item = normalizePayload(req.body, req);
  latest = item;
  history.push(item);
  pushCount += 1;
  while (history.length > HISTORY_LIMIT) history.shift();
  res.json({ ok:true, stored:true, push_count: pushCount, history_count: history.length, allow_remote_commands: 0, latest: item });
});

app.get('/api/latest', requireViewTokenIfSet, (req, res) => {
  res.json({ ok:true, latest, history_count: history.length, push_count: pushCount, allow_remote_commands: 0, state_model: 'rs232_web_cloud_state_v1' });
});

app.get('/api/history', requireViewTokenIfSet, (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || HISTORY_LIMIT), HISTORY_LIMIT));
  res.json({ ok:true, history: history.slice(-limit), history_count: history.length, limit, allow_remote_commands: 0, state_model: 'rs232_web_cloud_state_v1' });
});

// Future command queue endpoints are intentionally present but disabled in CLOUD_004.
app.post('/api/request-command', requireViewTokenIfSet, (req, res) => {
  res.status(403).json({ ok:false, error:'remote_commands_disabled', allow_remote_commands: 0 });
});
app.get('/api/pull', requireDeviceToken, (req, res) => {
  res.json({ ok:true, has_command:false, command:null, allow_remote_commands: 0, note:'command queue disabled in CLOUD_004' });
});
app.post('/api/ack', requireDeviceToken, (req, res) => {
  res.status(403).json({ ok:false, error:'remote_commands_disabled', allow_remote_commands: 0 });
});

app.get('/health', (req, res) => {
  res.json({
    ok:true,
    service:'RS232_WEB_CLOUD_004_StateModel',
    boot_time: bootTime,
    now: nowIso(),
    has_latest: !!latest,
    push_count: pushCount,
    history_count: history.length,
    history_limit: HISTORY_LIMIT,
    post_protected: !!DEVICE_TOKEN,
    view_protected: !!VIEW_TOKEN,
    allow_remote_commands: 0,
    state_model: 'rs232_web_cloud_state_v1'
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
  console.log(`RS232_WEB_CLOUD_004_StateModel listening on ${PORT}`);
});
