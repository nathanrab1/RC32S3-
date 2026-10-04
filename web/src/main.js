import * as Blockly from 'blockly';
import * as Pt from 'blockly/msg/pt-br';
import './style.css';
import { registerBlocks } from './blocks/rc_blocks.js';
import { cpp } from './generator/cpp.js';
import { toolboxTx, toolboxRx, defaultTx, defaultRx } from './toolbox.js';
import { getStatus, listPorts, build } from './uploader.js';
import { initMonitor, toggleMonitor, updatePorts, rememberPort, releaseAll } from './monitor.js';

Blockly.setLocale(Pt);
registerBlocks();

const ROLES = {
  tx: { label: 'Controle', toolbox: toolboxTx, initial: defaultTx, el: 'ws-tx' },
  rx: { label: 'Carrinho', toolbox: toolboxRx, initial: defaultRx, el: 'ws-rx' },
};

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'rc.project';

// ------------------------------------------------------------------ Workspaces

const workspaces = {};
for (const [role, cfg] of Object.entries(ROLES)) {
  const ws = Blockly.inject(cfg.el, {
    toolbox: cfg.toolbox,
    renderer: 'zelos',
    trashcan: true,
    grid: { spacing: 24, length: 3, colour: '#dde2ec', snap: true },
    zoom: { controls: true, wheel: true, startScale: 0.8, maxScale: 2, minScale: 0.4 },
    move: { scrollbars: true, drag: true, wheel: false },
  });
  ws.addChangeListener(Blockly.Events.disableOrphans);
  workspaces[role] = ws;
}

function loadState(role, state) {
  workspaces[role].clear();
  Blockly.serialization.workspaces.load(state || ROLES[role].initial, workspaces[role]);
}

function projectState() {
  return {
    formato: 'rc32s3',
    versao: 1,
    controle: Blockly.serialization.workspaces.save(workspaces.tx),
    carrinho: Blockly.serialization.workspaces.save(workspaces.rx),
  };
}

function loadProject(p) {
  loadState('tx', p?.controle);
  loadState('rx', p?.carrinho);
}

// Recupera o último projeto deste navegador (se houver).
try {
  loadProject(JSON.parse(localStorage.getItem(STORAGE_KEY)));
} catch {
  loadProject(null);
}

let saveTimer;
for (const ws of Object.values(workspaces)) {
  ws.addChangeListener((e) => {
    if (e.isUiEvent) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(projectState()));
      } catch {
        /* armazenamento indisponível: tudo bem, o usuário pode salvar em arquivo */
      }
    }, 500);
  });
}

// ------------------------------------------------------------------ Abas

let current = 'tx';
function selectTab(role) {
  current = role;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === role));
  for (const r of Object.keys(ROLES)) $(ROLES[r].el).classList.toggle('active', r === role);
  $('upload-target').textContent = ROLES[role].label;
  Blockly.svgResize(workspaces[role]);
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));
window.addEventListener('resize', () => Blockly.svgResize(workspaces[current]));
if (location.hash === '#carrinho') selectTab('rx');

// ------------------------------------------------------------------ Log

const log = {
  open() { $('log').dataset.state = 'open'; $('log-toggle').textContent = '▼ Mensagens'; },
  clear() { $('log-body').textContent = ''; },
  line(text) {
    const body = $('log-body');
    body.textContent += text + '\n';
    body.scrollTop = body.scrollHeight;
  },
  summary(text, kind) {
    const s = $('log-summary');
    s.textContent = text;
    s.className = 'log-summary ' + (kind || '');
  },
};
$('log-toggle').addEventListener('click', () => {
  const open = $('log').dataset.state !== 'open';
  $('log').dataset.state = open ? 'open' : 'closed';
  $('log-toggle').textContent = (open ? '▼' : '▲') + ' Mensagens';
  Blockly.svgResize(workspaces[current]);
});

// ------------------------------------------------------------------ Verificações antes de gravar

function checkProgram(role) {
  const ws = workspaces[role];
  const types = ws.getAllBlocks(false).filter((b) => b.isEnabled()).map((b) => b.type);
  const has = (t) => types.includes(t);
  const problems = [];
  if (!has('rc_setup') && !has('rc_loop')) problems.push('Coloque blocos dentro de "ao ligar" ou "repetir sempre".');
  const usesRadio = types.some((t) => t.startsWith('rc_') && /channel|message|connected|signal|on_lost|on_restored/.test(t));
  if (usesRadio && !has('rc_radio_begin')) problems.push('Falta o bloco "ligar rádio na rede" dentro de "ao ligar".');
  if ((has('rc_motor_speed') || has('rc_motor_stop')) && !has('rc_motor_setup')) {
    problems.push('Falta o bloco "configurar motor (ESC)".');
  }
  const servosUsed = ws.getAllBlocks(false)
    .filter((b) => b.isEnabled() && (b.type === 'rc_servo_position' || b.type === 'rc_servo_angle'))
    .map((b) => b.getFieldValue('SERVO'));
  const servosSetup = ws.getAllBlocks(false)
    .filter((b) => b.isEnabled() && b.type === 'rc_servo_setup')
    .map((b) => b.getFieldValue('SERVO'));
  for (const s of new Set(servosUsed)) {
    if (!servosSetup.includes(s)) problems.push(`Falta o bloco "configurar servo ${s === 'direcao' ? 'direção' : s}".`);
  }
  return problems;
}

function networkOf(role) {
  const b = workspaces[role].getAllBlocks(false).find((x) => x.type === 'rc_radio_begin' && x.isEnabled());
  return b ? Number(b.getFieldValue('NET')) : null;
}

// ------------------------------------------------------------------ Gravar / verificar

let busy = false;
async function runBuild(upload) {
  if (busy) return;
  const role = current;
  const label = ROLES[role].label;
  const problems = checkProgram(role);
  log.open();
  log.clear();
  if (problems.length) {
    problems.forEach((p) => log.line('⚠️ ' + p));
    log.summary(`Corrija o programa do ${label} antes de continuar.`, 'err');
    return;
  }
  const other = role === 'tx' ? 'rx' : 'tx';
  const netA = networkOf(role);
  const netB = networkOf(other);
  if (netA !== null && netB !== null && netA !== netB) {
    log.line(`⚠️ Atenção: o ${label} usa a rede ${netA}, mas o ${ROLES[other].label} usa a rede ${netB}. Eles não vão se comunicar!`);
  }

  const port = $('port-select').value;
  if (upload && !port) {
    log.summary('Escolha a placa (porta USB) ao lado do botão Gravar.', 'err');
    return;
  }

  busy = true;
  $('btn-upload').disabled = $('btn-verify').disabled = true;
  log.summary(upload ? `Gravando o ${label}… (a primeira vez demora mais)` : `Verificando o ${label}…`, 'busy');
  try {
    const code = cpp.sketch(workspaces[role]);
    const ok = await build({ code, port, upload }, (l) => log.line(l));
    if (ok && upload) rememberPort(role, port);
    log.summary(
      ok ? (upload ? `✅ ${label} gravado com sucesso!` : `✅ O programa do ${label} está certo.`) : '❌ Deu erro. Veja as mensagens acima.',
      ok ? 'ok' : 'err',
    );
  } catch (err) {
    log.line(String(err.message || err));
    log.summary('❌ Não consegui falar com o gravador. Ele está ligado?', 'err');
    refreshStatus();
  } finally {
    busy = false;
    $('btn-upload').disabled = $('btn-verify').disabled = false;
  }
}
$('btn-upload').addEventListener('click', () => runBuild(true));
$('btn-verify').addEventListener('click', () => runBuild(false));

// ------------------------------------------------------------------ Gravador local

async function refreshStatus() {
  const status = await getStatus();
  const el = $('server-status');
  if (!status) {
    el.className = 'status';
    el.textContent = '● gravador desligado';
    el.title = 'Clique para ver como instalar o gravador';
    return false;
  }
  if (!status.pronto) {
    el.className = 'status warn';
    el.textContent = '● gravador sem ESP32';
    el.title = status.mensagem || 'Rode "npm run setup" na pasta server';
    return false;
  }
  el.className = 'status ok';
  el.textContent = '● gravador pronto';
  el.title = `arduino-cli ${status.arduinoCli || ''}`;
  return true;
}

async function refreshPorts() {
  const select = $('port-select');
  const previous = select.value;
  try {
    const ports = await listPorts();
    select.innerHTML = '<option value="">— placa —</option>';
    for (const p of ports) {
      const opt = document.createElement('option');
      opt.value = p.endereco;
      opt.textContent = p.nome;
      select.append(opt);
    }
    updatePorts(ports);
    const esp = ports.find((p) => p.esp32);
    if (ports.some((p) => p.endereco === previous)) select.value = previous;
    else if (esp) select.value = esp.endereco;
  } catch {
    /* gravador desligado: o indicador de status já avisa */
  }
}

$('server-status').addEventListener('click', () => $('help').showModal());

initMonitor();

async function releasePorts() {
  log.open();
  try {
    const r = await releaseAll();
    if (r.outros.length) r.outros.forEach((o) => log.line('⏹ fechado: ' + o));
    log.summary(
      `⏹ Portas liberadas (${r.monitores} monitor(es) deste app${r.outros.length ? `, ${r.outros.length} outro(s) programa(s)` : ''}). Pode gravar.`,
      'ok',
    );
  } catch (err) {
    log.summary('❌ Não consegui liberar as portas: ' + (err.message || err), 'err');
  }
}
$('btn-release').addEventListener('click', releasePorts);
$('btn-monitor').addEventListener('click', () => {
  toggleMonitor();
  Blockly.svgResize(workspaces[current]);
});
$('btn-refresh').addEventListener('click', async () => {
  if (await refreshStatus()) refreshPorts();
});

(async function poll() {
  if (await refreshStatus()) await refreshPorts();
  setTimeout(poll, 5000);
})();

// ------------------------------------------------------------------ Menu Projeto

$('btn-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  $('menu-list').hidden = !$('menu-list').hidden;
});
document.addEventListener('click', () => ($('menu-list').hidden = true));

function download(filename, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const actions = {
  new() {
    if (confirm('Começar um projeto novo? O projeto atual será apagado (salve antes se quiser).')) loadProject(null);
  },
  open() { $('file-input').click(); },
  save() {
    const name = (prompt('Nome do projeto:', 'meu-carrinho') || '').trim();
    if (name) download(`${name}.rc.json`, JSON.stringify(projectState(), null, 2), 'application/json');
  },
  download() {
    const label = ROLES[current].label.toLowerCase();
    download(`${label}.ino`, cpp.sketch(workspaces[current]), 'text/plain');
  },
  help() { $('help').showModal(); },
  release: () => releasePorts(),
};
document.querySelectorAll('#menu-list button').forEach((b) =>
  b.addEventListener('click', () => actions[b.dataset.action]()),
);

$('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const p = JSON.parse(await file.text());
    if (p.formato !== 'rc32s3' && p.formato !== 'blockly-rc') throw new Error('formato');
    loadProject(p);
  } catch {
    alert('Este arquivo não é um projeto do RC32S3.');
  }
});

// Para depuração no console do navegador.
window.rc = { workspaces, cpp };
