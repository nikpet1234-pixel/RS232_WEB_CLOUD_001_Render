const express = require('express');
const path = require('path');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

const SERVICE = 'RS232_WEB_CLOUD_010_FastCommandUI';
const STATE_MODEL = 'rs232_web_cloud_state_v1';
const PORT = process.env.PORT || 10000;
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || '';
const VIEW_TOKEN = process.env.VIEW_TOKEN || '';
const COMMAND_TOKEN = process.env.COMMAND_TOKEN || '';
const HISTORY_LIMIT = Math.max(1, Math.min(Number(process.env.HISTORY_LIMIT || 100), 1000));
const COMMAND_QUEUE_LIMIT = Math.max(1, Math.min(Number(process.env.COMMAND_QUEUE_LIMIT || 20), 100));
const ACK_HISTORY_LIMIT = Math.max(1, Math.min(Number(process.env.ACK_HISTORY_LIMIT || 50), 500));

function envEnabled(name) {
  return ['1','true','yes','on','enabled'].includes(String(process.env[name] || '').trim().toLowerCase());
}

// Safe by default. Both flags must be enabled in Render Environment for commands to be queued.
const ALLOW_REMOTE_COMMANDS = envEnabled('ALLOW_REMOTE_COMMANDS') || envEnabled('REMOTE_COMMANDS_ENABLED');
const COMMAND_QUEUE_ENABLED = envEnabled('COMMAND_QUEUE_ENABLED');
const COMMANDS_ACTIVE = !!(ALLOW_REMOTE_COMMANDS && COMMAND_QUEUE_ENABLED && COMMAND_TOKEN);

let latest = null;
let history = [];
let pushCount = 0;
let bootTime = new Date().toISOString();
let commandQueue = [];
let commandSeq = 0;
let ackHistory = [];

const UI_STATE_MAP = {
  service: SERVICE,
  mode: COMMANDS_ACTIVE ? 'device pull/ack simulation armed' : 'read-only / command queue not active',
  safety: 'Command requests require COMMAND_TOKEN; device pull/ack require DEVICE_TOKEN.',
  mapping: [
    { json: 'hold', ui: 'HOLD button color/text', values: '0=normal/STOP, 1=red/HOLD RUN', action: 'device state indication; cloud UI can queue hold_start/hold_stop when commands_active=1' },
    { json: 'loop_running', ui: 'Start/Stop Loop button color/text + Loop status', values: '0=Start Loop/OFF, 1=Stop Loop/ON', action: 'device state indication; cloud UI can queue loop_start/loop_stop when commands_active=1' },
    { json: 'trigger_state', ui: 'Trigger status pill', values: 'OK/ARMED=green, HIT/OUT=red, empty=---', action: 'read-only indication' },
    { json: 'trigger_hit', ui: 'Trigger status severity helper', values: '0=no hit, 1=hit', action: 'read-only indication' },
    { json: 'verified', ui: 'VERIFY indication', values: '0/1', action: 'read-only indication' },
    { json: 'trigger_parameter', ui: 'Selection field', values: 'U/I/P', action: 'can later be queued via set_trigger' },
    { json: 'trigger_by', ui: 'Trigger by field', values: 'CALC/L1/L2/L3', action: 'can later be queued via set_trigger' },
    { json: 'trigger_threshold', ui: 'Target field', values: 'numeric text', action: 'can later be queued via set_trigger' },
    { json: 'trigger_tolerance_pct', ui: 'Tol (%) field', values: 'numeric text', action: 'can later be queued via set_trigger' },
    { json: 'no / next_no', ui: 'No / Next № fields', values: 'text/number', action: 'can later be queued via set_next_no' },
    { json: 'article', ui: 'Article input', values: 'text', action: 'can later be queued via set_article' },
    { json: 'uavr/iavr/psum', ui: 'calculated aggregate boxes', values: 'device-sent values or ---', action: 'no cloud recalculation when missing' }
  ]
};

const COMMAND_MAP = {
  service: SERVICE,
  command_queue_enabled: COMMAND_QUEUE_ENABLED ? 1 : 0,
  allow_remote_commands: ALLOW_REMOTE_COMMANDS ? 1 : 0,
  command_token_configured: !!COMMAND_TOKEN,
  commands_active: COMMANDS_ACTIVE ? 1 : 0,
  policy: COMMANDS_ACTIVE
    ? 'Commands may be queued only with COMMAND_TOKEN. Device pull/ack uses DEVICE_TOKEN. ACK may include a state object that updates the latest cloud state.'
    : 'Commands are not active unless ALLOW_REMOTE_COMMANDS=1, COMMAND_QUEUE_ENABLED=1, and COMMAND_TOKEN is configured.',
  allowed_first_stage: [
    { cmd:'set_next_no', fields:['value'], note:'Set device next number.' },
    { cmd:'set_article', fields:['value'], note:'Set active article.' },
    { cmd:'set_trigger', fields:['parameter','by','threshold','tolerance_pct','autostop','enabled'], note:'Target/tolerance/selection/autostop.' },
    { cmd:'set_current_factor', fields:['value','current_factor'], note:'Set I factor.' },
    { cmd:'set_measurement_options', fields:['u_mode','active_phases','l1','l2','l3','calc_inductance','current_factor'], note:'Voltage mode, phase selection, inductance and I factor.' },
    { cmd:'set_phase_options', fields:['active_phases','l1','l2','l3'], note:'Set active phases.' },
    { cmd:'hold_toggle', fields:[], note:'Toggle device HOLD.' },
    { cmd:'hold_start', fields:[], note:'Set HOLD on.' },
    { cmd:'hold_stop', fields:[], note:'Set HOLD off.' },
    { cmd:'loop_start', fields:[], note:'Start device loop.' },
    { cmd:'loop_stop', fields:[], note:'Stop device loop.' },
    { cmd:'loop_toggle', fields:[], note:'Toggle device loop.' },
    { cmd:'set_cloud_note', fields:['value','note','message'], note:'Diagnostic note.' }
  ],
  still_forbidden: ['sdtools','settings','firmware_update','file_read','file_write','api_read','print','delete_log']
};

function nowIso() { return new Date().toISOString(); }
function clientIp(req) { return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim(); }
function tokenFromReq(req) {
  const auth = req.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return (req.get('x-device-token') || req.get('x-command-token') || req.query.token || '').toString().trim();
}
function commandTokenFromReq(req) {
  const auth = req.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return (req.get('x-command-token') || req.query.command_token || req.query.token || '').toString().trim();
}
function requireDeviceToken(req, res, next) {
  if (!DEVICE_TOKEN) return res.status(500).json({ ok:false, error:'DEVICE_TOKEN is not configured on server' });
  if (tokenFromReq(req) !== DEVICE_TOKEN) return res.status(401).json({ ok:false, error:'Unauthorized' });
  next();
}
function requireCommandToken(req, res, next) {
  if (!COMMANDS_ACTIVE) {
    return res.status(403).json({
      ok:false,
      error:'remote_commands_disabled',
      queued:false,
      stored:false,
      allow_remote_commands: ALLOW_REMOTE_COMMANDS ? 1 : 0,
      command_queue_enabled: COMMAND_QUEUE_ENABLED ? 1 : 0,
      command_token_configured: !!COMMAND_TOKEN,
      commands_active: 0,
      note:'Enable ALLOW_REMOTE_COMMANDS=1 and COMMAND_QUEUE_ENABLED=1 and configure COMMAND_TOKEN in Render to arm the queue.'
    });
  }
  if (commandTokenFromReq(req) !== COMMAND_TOKEN) return res.status(401).json({ ok:false, error:'Unauthorized command token' });
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
    else if (Array.isArray(v)) out[k] = v.slice(0, 20).map(x => (x && typeof x === 'object') ? cleanObj(x) : cleanValue(x));
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
    schema: cleanValue(b.schema || b.state_schema || STATE_MODEL),
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

    // Aggregates are accepted from the device. CLOUD_007 does not calculate them when missing.
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

    allow_remote_commands: ALLOW_REMOTE_COMMANDS ? 1 : 0,
    command_queue_enabled: COMMAND_QUEUE_ENABLED ? 1 : 0,
    commands_active: COMMANDS_ACTIVE ? 1 : 0,
    received_at: nowIso(),
    remote_ip: req ? clientIp(req) : '',
    raw_state: cleanObj(b)
  };
  if (!out.next_no && out.no) out.next_no = out.no;
  return out;
}

function allowedCommand(cmd) {
  return COMMAND_MAP.allowed_first_stage.some(c => c.cmd === String(cmd || '').trim());
}
function normalizeCommand(body, req) {
  const b = body || {};
  const cmd = cleanValue(firstDefined(b, ['cmd','command','type']), 40);
  const payload = cleanObj(b.payload && typeof b.payload === 'object' ? b.payload : b);
  delete payload.command_token;
  delete payload.token;
  return {
    id: 'cmd-' + String(++commandSeq).padStart(6, '0'),
    cmd,
    payload,
    status: 'pending',
    created_at: nowIso(),
    requested_by: clientIp(req),
    source: cleanValue(firstDefined(b, ['source']) || 'cloud_ui', 40),
    delivery_count: 0,
    last_pulled_at: '',
    ack: null
  };
}
function commandSummary(includeAck=false) {
  const base = {
    ok:true,
    service: SERVICE,
    command_queue_enabled: COMMAND_QUEUE_ENABLED ? 1 : 0,
    allow_remote_commands: ALLOW_REMOTE_COMMANDS ? 1 : 0,
    command_token_configured: !!COMMAND_TOKEN,
    commands_active: COMMANDS_ACTIVE ? 1 : 0,
    pending_count: commandQueue.length,
    ack_count: ackHistory.length,
    command_seq: commandSeq,
    command_queue_limit: COMMAND_QUEUE_LIMIT,
    note: COMMANDS_ACTIVE ? 'Command queue is armed. Device pull/ack simulation is available with DEVICE_TOKEN.' : 'Command queue is present but not active.'
  };
  if (includeAck) base.ack_history = ackHistory.slice(-20);
  return base;
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
  res.json({ ok:true, stored:true, push_count: pushCount, history_count: history.length, allow_remote_commands: item.allow_remote_commands, command_queue_enabled: item.command_queue_enabled, commands_active: item.commands_active, latest: item });
});

app.get('/api/latest', requireViewTokenIfSet, (req, res) => {
  res.json({ ok:true, latest, history_count: history.length, push_count: pushCount, allow_remote_commands: ALLOW_REMOTE_COMMANDS ? 1 : 0, command_queue_enabled: COMMAND_QUEUE_ENABLED ? 1 : 0, commands_active: COMMANDS_ACTIVE ? 1 : 0, state_model: STATE_MODEL });
});

app.get('/api/history', requireViewTokenIfSet, (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || HISTORY_LIMIT), HISTORY_LIMIT));
  res.json({ ok:true, history: history.slice(-limit), history_count: history.length, limit, allow_remote_commands: ALLOW_REMOTE_COMMANDS ? 1 : 0, command_queue_enabled: COMMAND_QUEUE_ENABLED ? 1 : 0, commands_active: COMMANDS_ACTIVE ? 1 : 0, state_model: STATE_MODEL });
});

app.post('/api/request-command', requireCommandToken, (req, res) => {
  const item = normalizeCommand(req.body || {}, req);
  if (!allowedCommand(item.cmd)) {
    return res.status(400).json({ ok:false, error:'command_not_allowed', queued:false, stored:false, allowed: COMMAND_MAP.allowed_first_stage.map(c => c.cmd), attempted_command: item.cmd });
  }
  if (commandQueue.length >= COMMAND_QUEUE_LIMIT) {
    return res.status(429).json({ ok:false, error:'command_queue_full', queued:false, stored:false, pending_count: commandQueue.length, command_queue_limit: COMMAND_QUEUE_LIMIT });
  }
  commandQueue.push(item);
  res.json({ ok:true, queued:true, stored:true, command: item, pending_count: commandQueue.length, command_seq: commandSeq });
});

app.get('/api/pull', requireDeviceToken, (req, res) => {
  if (!COMMANDS_ACTIVE) {
    return res.json({ ok:true, has_command:false, command:null, allow_remote_commands: ALLOW_REMOTE_COMMANDS ? 1 : 0, command_queue_enabled: COMMAND_QUEUE_ENABLED ? 1 : 0, commands_active: 0, pending_count: 0, note:'command queue not active' });
  }
  const item = commandQueue[0] || null;
  if (!item) return res.json({ ok:true, has_command:false, command:null, pending_count: 0, commands_active: 1 });
  item.delivery_count += 1;
  item.last_pulled_at = nowIso();
  res.json({ ok:true, has_command:true, command: item, pending_count: commandQueue.length, commands_active: 1 });
});

app.post('/api/ack', requireDeviceToken, (req, res) => {
  if (!COMMANDS_ACTIVE) {
    return res.status(403).json({ ok:false, error:'remote_commands_disabled', ack_stored:false, allow_remote_commands: ALLOW_REMOTE_COMMANDS ? 1 : 0, command_queue_enabled: COMMAND_QUEUE_ENABLED ? 1 : 0, commands_active: 0, attempted_ack: cleanObj(req.body || {}) });
  }
  const b = req.body || {};
  const id = cleanValue(firstDefined(b, ['id','command_id','cmd_id']));
  if (!id) return res.status(400).json({ ok:false, error:'missing_command_id' });
  const idx = commandQueue.findIndex(c => c.id === id);
  if (idx < 0) return res.status(404).json({ ok:false, error:'command_not_found', command_id: id });
  const item = commandQueue.splice(idx, 1)[0];
  const resultState = b.state && typeof b.state === 'object' ? cleanObj(b.state) : {};
  const ack = {
    id,
    cmd: item.cmd,
    ok: String(firstDefined(b, ['ok','success']) || 'true'),
    message: cleanValue(firstDefined(b, ['message','msg','error']) || ''),
    device_time: cleanValue(firstDefined(b, ['device_time','time']) || ''),
    ack_at: nowIso(),
    ack_from: clientIp(req),
    original_command: item,
    result_state: resultState,
    latest_updated_from_ack: false
  };

  // CLOUD_010 addition: for simulation, ACK may carry a partial/full device state.
  // This lets us test the full loop without ESP32 firmware yet:
  // request-command -> device pull -> device ack with state -> cloud UI updates.
  if (Object.keys(resultState).length) {
    const merged = Object.assign({}, latest && latest.raw_state ? latest.raw_state : {}, resultState, {
      source: 'command_ack',
      last_command_id: id,
      last_command: item.cmd,
      last_command_ok: ack.ok,
      last_command_message: ack.message || 'ACK state applied'
    });
    latest = normalizePayload(merged, req);
    history.push(latest);
    pushCount += 1;
    while (history.length > HISTORY_LIMIT) history.shift();
    ack.latest_updated_from_ack = true;
  }

  ackHistory.push(ack);
  while (ackHistory.length > ACK_HISTORY_LIMIT) ackHistory.shift();
  res.json({ ok:true, ack_stored:true, removed_from_pending:true, latest_updated_from_ack: ack.latest_updated_from_ack, ack, pending_count: commandQueue.length, ack_count: ackHistory.length, latest });
});

app.get('/api/command-queue', requireViewTokenIfSet, (req, res) => {
  const includeAck = String(req.query.ack || '').trim() === '1';
  res.json({ ...commandSummary(includeAck), pending: commandQueue });
});
app.get('/api/command-map', requireViewTokenIfSet, (req, res) => {
  res.json({ ok:true, command_map: COMMAND_MAP });
});

app.get('/api/ack-history', requireViewTokenIfSet, (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 20), ACK_HISTORY_LIMIT));
  res.json({ ok:true, service: SERVICE, ack_count: ackHistory.length, ack_history: ackHistory.slice(-limit) });
});

app.get('/api/state-map', requireViewTokenIfSet, (req, res) => {
  res.json({ ok:true, allow_remote_commands: ALLOW_REMOTE_COMMANDS ? 1 : 0, command_queue_enabled: COMMAND_QUEUE_ENABLED ? 1 : 0, commands_active: COMMANDS_ACTIVE ? 1 : 0, state_model: STATE_MODEL, ui_state_map: UI_STATE_MAP });
});

app.get('/health', (req, res) => {
  res.json({
    ok:true,
    service: SERVICE,
    boot_time: bootTime,
    now: nowIso(),
    has_latest: !!latest,
    push_count: pushCount,
    history_count: history.length,
    history_limit: HISTORY_LIMIT,
    post_protected: !!DEVICE_TOKEN,
    view_protected: !!VIEW_TOKEN,
    allow_remote_commands: ALLOW_REMOTE_COMMANDS ? 1 : 0,
    command_queue_enabled: COMMAND_QUEUE_ENABLED ? 1 : 0,
    command_token_configured: !!COMMAND_TOKEN,
    commands_active: COMMANDS_ACTIVE ? 1 : 0,
    state_model: STATE_MODEL,
    ui_state_map: 'v1',
    pending_commands: commandQueue.length,
    ack_count: ackHistory.length,
    command_seq: commandSeq,
    device_pull_ack_sim: 'v1',
    ack_can_update_latest: true
  });
});

function forbidden(req, res) {
  res.status(403).json({ ok:false, error:'Forbidden in cloud mode', allow_remote_commands: ALLOW_REMOTE_COMMANDS ? 1 : 0, command_queue_enabled: COMMAND_QUEUE_ENABLED ? 1 : 0 });
}
['/api/read','/api/loop','/api/hold','/api/command','/api/settings','/api/set','/api/status','/api/measurement','/api/log','/api/addlog','/api/clearrows','/api/print','/api/printrow','/api/printlog','/api/printertest','/api/soundtest','/api/console','/api/profile','/api/detect','/api/baud','/api/sd/list','/api/sd/download','/api/sd/downloadfile','/api/fft/read','/api/fft/csv','/api/fft/sd','/sdtools','/diag','/embedded'].forEach(route => {
  app.all(route, forbidden);
});

app.use((req, res) => res.status(404).json({ ok:false, error:'Not found' }));

app.listen(PORT, () => {
  console.log(`${SERVICE} listening on ${PORT}. commands_active=${COMMANDS_ACTIVE ? 1 : 0}`);
});
