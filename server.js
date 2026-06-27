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
const ALLOW_REMOTE_COMMANDS = false; // CLOUD_006: command queue scaffold exists, but remote commands are disabled by design.
const COMMAND_QUEUE_ENABLED = false;
const COMMAND_QUEUE_LIMIT = Math.max(1, Math.min(Number(process.env.COMMAND_QUEUE_LIMIT || 20), 100));
let commandQueue = [];
let commandSeq = 0;
let ackHistory = [];

let latest = null;
let history = [];
let pushCount = 0;
let bootTime = new Date().toISOString();

const UI_STATE_MAP = {
  service: 'RS232_WEB_CLOUD_006_CommandQueue_DISABLED',
  mode: 'read-only; command queue disabled; remote commands disabled',
  mapping: [
    { json: 'hold', ui: 'HOLD button color/text', values: '0=normal/STOP, 1=red/HOLD RUN', action: 'read-only indication' },
    { json: 'loop_running', ui: 'Start/Stop Loop button color/text + Loop status', values: '0=Start Loop/OFF, 1=Stop Loop/ON', action: 'read-only indication' },
    { json: 'trigger_state', ui: 'Trigger status pill', values: 'OK/ARMED=green, HIT/OUT=red, empty=---', action: 'read-only indication' },
    { json: 'trigger_hit', ui: 'Trigger status severity helper', values: '0=no hit, 1=hit', action: 'read-only indication' },
    { json: 'verified', ui: 'VERIFY indication', values: '0/1', action: 'read-only indication' },
    { json: 'trigger_parameter', ui: 'Selection field', values: 'U/I/P', action: 'local display follows device state' },
    { json: 'trigger_by', ui: 'Trigger by field', values: 'CALC/L1/L2/L3', action: 'local display follows device state' },
    { json: 'trigger_threshold', ui: 'Target field', values: 'numeric text', action: 'local display follows device state' },
    { json: 'trigger_tolerance_pct', ui: 'Tol (%) field', values: 'numeric text', action: 'local display follows device state' },
    { json: 'no / next_no', ui: 'No / Next № fields', values: 'text/number', action: 'local display follows device state' },
    { json: 'article', ui: 'Article input', values: 'text', action: 'local display follows device state' },
    { json: 'uavr/iavr/psum', ui: 'calculated aggregate boxes', values: 'device-sent values or ---', action: 'no cloud recalculation when missing' }
  ]
};


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

    // Aggregates are accepted from the device. CLOUD_006 does not calculate them when missing.
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




const FUTURE_COMMAND_MAP = {
  service: 'RS232_WEB_CLOUD_006_CommandQueue_DISABLED',
  command_queue_enabled: 0,
  allow_remote_commands: 0,
  policy: 'No command is stored, queued, pulled, or acknowledged while allow_remote_commands=0.',
  future_allowed_first_stage: [
    { cmd:'set_next_no', fields:['value'], note:'Future soft setting only; disabled now.' },
    { cmd:'set_article', fields:['value'], note:'Future soft setting only; disabled now.' },
    { cmd:'set_trigger', fields:['parameter','by','threshold','tolerance_pct','autostop','enabled'], note:'Future soft trigger setup only; disabled now.' },
    { cmd:'set_cloud_note', fields:['value'], note:'Future display-only note; disabled now.' }
  ],
  forbidden_in_cloud: ['sdtools','settings','firmware_update','file_read','file_write','api_read','loop_start','loop_stop','hold_toggle','print','delete_log']
};
function commandSummary(){
  return {
    ok:true,
    service:'RS232_WEB_CLOUD_006_CommandQueue_DISABLED',
    command_queue_enabled: 0,
    allow_remote_commands: 0,
    pending_count: commandQueue.length,
    ack_count: ackHistory.length,
    command_seq: commandSeq,
    note:'Command queue scaffold is present but disabled. No commands are stored.'
  };
}

// CLOUD_006: Future command queue endpoints are present, but intentionally disabled.
// This lets the UI and ESP32-side design be tested safely before any device control exists.
app.post('/api/request-command', requireViewTokenIfSet, (req, res) => {
  const attempted = cleanObj(req.body || {});
  res.status(403).json({
    ok:false,
    error:'remote_commands_disabled',
    queued:false,
    stored:false,
    allow_remote_commands: 0,
    command_queue_enabled: 0,
    attempted_command: attempted,
    pending_count: commandQueue.length,
    note:'CLOUD_006 does not store commands. Enablement must be a later explicit version.'
  });
});
app.get('/api/pull', requireDeviceToken, (req, res) => {
  res.json({
    ok:true,
    has_command:false,
    command:null,
    allow_remote_commands: 0,
    command_queue_enabled: 0,
    pending_count: 0,
    note:'command queue disabled in CLOUD_006'
  });
});
app.post('/api/ack', requireDeviceToken, (req, res) => {
  const attempted = cleanObj(req.body || {});
  res.status(403).json({
    ok:false,
    error:'remote_commands_disabled',
    ack_stored:false,
    allow_remote_commands: 0,
    command_queue_enabled: 0,
    attempted_ack: attempted
  });
});
app.get('/api/command-queue', requireViewTokenIfSet, (req, res) => {
  res.json({ ...commandSummary(), pending: [] });
});
app.get('/api/command-map', requireViewTokenIfSet, (req, res) => {
  res.json({ ok:true, command_map: FUTURE_COMMAND_MAP });
});

app.get('/api/state-map', requireViewTokenIfSet, (req, res) => {
  res.json({ ok:true, allow_remote_commands: 0, state_model: 'rs232_web_cloud_state_v1', ui_state_map: UI_STATE_MAP });
});

app.get('/health', (req, res) => {
  res.json({
    ok:true,
    service:'RS232_WEB_CLOUD_006_CommandQueue_DISABLED',
    boot_time: bootTime,
    now: nowIso(),
    has_latest: !!latest,
    push_count: pushCount,
    history_count: history.length,
    history_limit: HISTORY_LIMIT,
    post_protected: !!DEVICE_TOKEN,
    view_protected: !!VIEW_TOKEN,
    allow_remote_commands: 0,
    state_model: 'rs232_web_cloud_state_v1',
    ui_state_map: 'v1',
    command_queue_enabled: 0,
    pending_commands: commandQueue.length,
    ack_count: ackHistory.length
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
  console.log(`RS232_WEB_CLOUD_006_CommandQueue_DISABLED listening on ${PORT}`);
});
