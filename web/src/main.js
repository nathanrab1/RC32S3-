import * as Blockly from 'blockly';
import * as Pt from 'blockly/msg/pt-br';
import './style.css';
import { registerBlocks } from './blocks/rc_blocks.js';
import { cpp } from './generator/cpp.js';
import { defaultProject } from './toolbox.js';
import { getStatus, listPorts, build } from './uploader.js';
import { initMonitor, toggleMonitor, updatePorts, releaseAll } from './monitor.js';
import {
  ROLE_LABEL, setPorts, assignRole, portForRole, roleOfPort, boardLabel, boardName, boardTag, setBoardName, swapRoles, hasRoles, forgetBoard, onBoardsChange,
} from './boards.js';
import { initPalette } from './palette.js';
import { serializeProject, parseProject, fileSlug, nameFromFile, EXTENSION } from './project.js';

Blockly.setLocale(Pt);
registerBlocks();

const ROLES = {
  tx: { label: 'Controle', initial: defaultProject.controle, el: 'ws-tx' },
  rx: { label: 'Carrinho', initial: defaultProject.carrinho, el: 'ws-rx' },
};

const $ = (id) => document.getElementById(id);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const STORAGE_KEY = 'rc.project';

// ------------------------------------------------------------------ Workspaces
// Controle à esquerda, Carrinho à direita; os blocos vêm da paleta do meio.

const workspaces = {};
for (const [role, cfg] of Object.entries(ROLES)) {
  const ws = Blockly.inject(cfg.el, {
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

// O projeto é sempre o PAR: Controle + Carrinho.
function projectState() {
  return {
    nome: $('project-name').value.trim() || 'meu-projeto',
    controle: Blockly.serialization.workspaces.save(workspaces.tx),
    carrinho: Blockly.serialization.workspaces.save(workspaces.rx),
  };
}

// Guarda no navegador para não perder nada ao recarregar a página.
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, serializeProject(projectState()));
  } catch {
    /* armazenamento indisponível: tudo bem, o usuário pode baixar o projeto */
  }
}

let dirty = false; // mudou algo desde que baixou/abriu?

// Carrega os dois programas. Se algo der errado, volta ao projeto anterior.
function loadProject(p) {
  const backup = workspaces.tx.getAllBlocks(false).length || workspaces.rx.getAllBlocks(false).length ? projectState() : null;
  Blockly.Events.disable();
  try {
    loadState('tx', p?.controle);
    loadState('rx', p?.carrinho);
  } catch (err) {
    if (backup) {
      loadState('tx', backup.controle);
      loadState('rx', backup.carrinho);
    }
    throw err;
  } finally {
    Blockly.Events.enable();
  }
  $('project-name').value = p?.nome || defaultProject.nome || 'meu-projeto';
  dirty = false;
  persist();
}

// Recupera o último projeto deste navegador (se houver).
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  loadProject(saved ? parseProject(saved) : null);
} catch {
  loadProject(null);
}

let saveTimer;
for (const ws of Object.values(workspaces)) {
  ws.addChangeListener((e) => {
    if (e.isUiEvent) return;
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 500);
  });
}
$('project-name').addEventListener('change', persist);
window.addEventListener('beforeunload', persist);

// ------------------------------------------------------------------ Paleta central

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2500);
}

const palette = initPalette({
  catsEl: $('palette-cats'),
  toolsEl: $('palette-tools'),
  wsEl: $('palette-ws'),
  targets: {
    tx: { ws: workspaces.tx, el: $('ws-tx') },
    rx: { ws: workspaces.rx, el: $('ws-rx') },
  },
  notify: toast,
});

function resizeAll() {
  for (const ws of [...Object.values(workspaces), palette.workspace]) Blockly.svgResize(ws);
}
window.addEventListener('resize', resizeAll);

// ------------------------------------------------------------------ Log

const log = {
  open() {
    if ($('log').dataset.state === 'open') return;
    $('log').dataset.state = 'open';
    $('log-toggle').textContent = '▼ Mensagens';
    resizeAll();
  },
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
// Alças verticais entre as colunas: Controle | Blocos | Carrinho.
// - esquerda: Controle e Blocos trocam largura (Carrinho fica igual);
// - direita: Blocos e Carrinho trocam largura (Controle fica igual).
// As larguras ficam guardadas; dois cliques voltam ao padrão.
function initColumnHandles() {
  const studio = document.querySelector('.studio');
  const txEl = document.querySelector('.side[data-role="tx"]');
  const palEl = document.querySelector('.palette');
  const KEY = 'rc.colunas';
  const MIN_SIDE = 240;
  const MIN_PAL = 220;
  let widths = null; // { tx?, pal } em px (tx ausente = Controle e Carrinho iguais)

  const available = () => studio.clientWidth - 16; // menos as duas alças
  const apply = () => {
    if (!widths) {
      studio.style.removeProperty('--tx-w');
      studio.style.removeProperty('--pal-w');
      return;
    }
    // Cabe na janela atual?
    const total = available();
    widths.pal = Math.max(MIN_PAL, Math.min(widths.pal, total - 2 * MIN_SIDE));
    studio.style.setProperty('--pal-w', `${Math.round(widths.pal)}px`);
    if (widths.tx) {
      widths.tx = Math.max(MIN_SIDE, Math.min(widths.tx, total - widths.pal - MIN_SIDE));
      studio.style.setProperty('--tx-w', `${Math.round(widths.tx)}px`);
    } else {
      studio.style.removeProperty('--tx-w');
    }
  };
  const save = () => {
    try {
      if (widths) localStorage.setItem(KEY, JSON.stringify(widths));
      else localStorage.removeItem(KEY);
    } catch {
      /* sem armazenamento: só não lembra */
    }
  };

  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved?.pal) widths = saved;
  } catch {
    /* usa o padrão */
  }
  apply();

  for (const handle of $$('.col-handle')) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const start = { tx: txEl.getBoundingClientRect().width, pal: palEl.getBoundingClientRect().width };
      const left = handle.dataset.col === 'left';
      let frame = 0;
      handle.classList.add('dragging');
      document.body.classList.add('resizing-cols');

      const move = (ev) => {
        const total = available();
        const dx = ev.clientX - startX;
        const hidden = studio.dataset.hide;
        if (hidden) {
          // Com um lado escondido, a alça que sobra só muda a paleta; a
          // largura guardada do lado escondido continua a mesma.
          const pal = Math.max(MIN_PAL, Math.min(start.pal + (left ? -dx : dx), total - MIN_SIDE - 40));
          widths = { ...widths, pal };
        } else if (left) {
          const tx = Math.max(MIN_SIDE, Math.min(start.tx + dx, start.tx + start.pal - MIN_PAL));
          widths = { tx, pal: start.tx + start.pal - tx };
        } else {
          const pal = Math.max(MIN_PAL, Math.min(start.pal + dx, total - start.tx - MIN_SIDE));
          widths = { tx: start.tx, pal };
        }
        apply();
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(resizeAll);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        handle.classList.remove('dragging');
        document.body.classList.remove('resizing-cols');
        resizeAll();
        save();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });

    handle.addEventListener('dblclick', () => {
      widths = null;
      apply();
      save();
      resizeAll();
    });
  }

  window.addEventListener('resize', () => {
    if (!widths) return;
    apply();
    resizeAll(); // de novo: o resizeAll normal rodou antes deste ajuste
  });
}
initColumnHandles();

// Esconder o Controle ou o Carrinho (um de cada vez). O estado fica guardado.
function initSideHiding() {
  const studio = document.querySelector('.studio');
  const KEY = 'rc.lado-escondido';
  const set = (role) => {
    if (role) studio.dataset.hide = role;
    else delete studio.dataset.hide;
    try {
      if (role) localStorage.setItem(KEY, role);
      else localStorage.removeItem(KEY);
    } catch {
      /* sem armazenamento: só não lembra */
    }
    resizeAll();
  };
  for (const b of $$('.side-hide')) b.addEventListener('click', () => set(b.dataset.role));
  for (const b of $$('.side-rail')) b.addEventListener('click', () => set(null));
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'tx' || saved === 'rx') studio.dataset.hide = saved;
  } catch {
    /* mostra os dois */
  }
}
initSideHiding();
resizeAll();

// Alças para mudar a altura do painel "Mensagens" e do Monitor Serial.
// A altura escolhida fica guardada; dois cliques voltam ao padrão.
function initResizeHandles() {
  for (const handle of $$('.resize-handle')) {
    const target = $(handle.dataset.resize);
    const key = `rc.altura.${handle.dataset.resize}`;
    const resetHeight = () => {
      target.style.height = '';
      try {
        localStorage.removeItem(key);
      } catch {
        /* nada a fazer */
      }
      resizeAll();
    };
    try {
      const saved = Number(localStorage.getItem(key));
      if (saved) target.style.height = `${saved}px`;
    } catch {
      /* sem armazenamento: usa a altura padrão */
    }

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const startH = target.getBoundingClientRect().height;
      const maxH = () => window.innerHeight * 0.75;
      let frame = 0;
      handle.classList.add('dragging');
      document.body.classList.add('resizing');

      const move = (ev) => {
        const h = Math.round(Math.min(maxH(), Math.max(60, startH + (startY - ev.clientY))));
        target.style.height = `${h}px`;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(resizeAll);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        handle.classList.remove('dragging');
        document.body.classList.remove('resizing');
        resizeAll();
        try {
          localStorage.setItem(key, String(Math.round(target.getBoundingClientRect().height)));
        } catch {
          /* sem armazenamento: só não lembra */
        }
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });

    // Dois cliques: volta ao tamanho padrão.
    handle.addEventListener('dblclick', resetHeight);

  }
}
initResizeHandles();

// A barra inteira de "Mensagens" abre/fecha o painel (não só a setinha).
document.querySelector('.log-head').addEventListener('click', () => {
  const open = $('log').dataset.state !== 'open';
  $('log').dataset.state = open ? 'open' : 'closed';
  $('log-toggle').textContent = (open ? '▼' : '▲') + ' Mensagens';
  resizeAll();
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
async function runBuild(role, upload) {
  if (busy) return;
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

  const port = portSelect(role).value;
  if (upload && !port) {
    log.summary(`Escolha a placa do ${label} (ao lado do botão Gravar).`, 'err');
    return;
  }

  busy = true;
  setBuildButtons(true);
  log.summary(upload ? `Gravando o ${label}… (a primeira vez demora mais)` : `Verificando o ${label}…`, 'busy');
  try {
    const code = cpp.sketch(workspaces[role]);
    const ok = await build({ code, port, upload }, (l) => log.line(l));
    if (ok && upload) assignRole(role, port);
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
    setBuildButtons(false);
  }
}

function setBuildButtons(disabled) {
  for (const b of $$('.side-upload, .side-verify')) b.disabled = disabled;
}
for (const b of $$('.side-upload')) b.addEventListener('click', () => runBuild(b.dataset.role, true));
for (const b of $$('.side-verify')) b.addEventListener('click', () => runBuild(b.dataset.role, false));

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
    el.textContent = '● sem ESP32';
    el.title = status.mensagem || 'Rode "npm run setup" na pasta server';
    return false;
  }
  el.className = 'status ok';
  el.textContent = '● pronto';
  el.title = `arduino-cli ${status.arduinoCli || ''}`;
  return true;
}

// Cada lado tem sua placa. A escolha é lembrada (e usada pelo Monitor).
const portSelect = (role) => document.querySelector(`.side-port[data-role="${role}"]`);

let lastPorts = [];

async function refreshPorts() {
  try {
    lastPorts = await listPorts();
  } catch {
    return; // gravador desligado: o indicador de status já avisa
  }
  setPorts(lastPorts);
  updatePorts(lastPorts);
  renderPortSelects();
}

// Controle primeiro, depois Carrinho, depois as placas novas.
function sortedPorts() {
  const rank = (p) => ({ tx: 0, rx: 1 })[Object.keys(ROLES).find((r) => portForRole(r) === p.endereco)] ?? 2;
  return [...lastPorts].sort((a, b) => rank(a) - rank(b));
}

// Cada lado mostra as placas pelo nome (🎮 Controle, 🚗 Carrinho, 🔌 Placa
// nova). A placa que já é do lado vem escolhida; um lado sem placa pega uma
// ESP32 que o outro lado não esteja usando.
function renderPortSelects() {
  const available = lastPorts.map((p) => p.endereco);
  const chosen = {};
  for (const role of Object.keys(ROLES)) {
    const own = portForRole(role);
    if (own) chosen[role] = own;
  }
  for (const role of Object.keys(ROLES)) {
    if (chosen[role]) continue;
    const previous = portSelect(role).value;
    const taken = Object.values(chosen);
    if (available.includes(previous) && !taken.includes(previous)) chosen[role] = previous;
    else {
      // Placa livre: ESP32 que não é de nenhum lado e não está escolhida.
      const owned = Object.keys(ROLES).map(portForRole);
      const free = lastPorts.find((p) => p.esp32 && !taken.includes(p.endereco) && !owned.includes(p.endereco));
      chosen[role] = free?.endereco || '';
    }
  }
  for (const role of Object.keys(ROLES)) {
    const select = portSelect(role);
    select.innerHTML = `<option value="">${ROLE_LABEL[role].split(' ')[0]} escolha a placa</option>`;
    for (const p of sortedPorts()) {
      const opt = document.createElement('option');
      opt.value = p.endereco;
      opt.textContent = boardLabel(p.endereco);
      opt.title = p.endereco;
      select.append(opt);
    }
    select.value = chosen[role] || '';
    select.title = chosen[role] ? `Placa do ${ROLES[role].label}: ${boardLabel(chosen[role])} — ${chosen[role]}` : `Escolha a placa do ${ROLES[role].label}`;
  }
}
for (const role of Object.keys(ROLES)) {
  portSelect(role).addEventListener('change', (e) => e.target.value && assignRole(role, e.target.value));
}
onBoardsChange(renderPortSelects);

// Menu ⋯ de cada lado: dar nome, trocar Controle ↔ Carrinho, esquecer.
const boardMenu = (role) => document.querySelector(`.side-board-list[data-role="${role}"]`);
const closeBoardMenus = () => Object.keys(ROLES).forEach((r) => (boardMenu(r).hidden = true));
for (const btn of $$('.side-board-btn')) {
  const role = btn.dataset.role;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = boardMenu(role);
    const open = menu.hidden;
    closeBoardMenus();
    $('menu-list').hidden = true;
    if (!open) return;
    const port = portSelect(role).value;
    const known = Boolean(port && boardTag(port));
    menu.querySelector('[data-board="rename"]').disabled = !known;
    menu.querySelector('[data-board="forget"]').disabled = !known || (!roleOfPort(port) && !boardName(port));
    menu.querySelector('[data-board="swap"]').disabled = !hasRoles();
    menu.hidden = false;
  });
  boardMenu(role).addEventListener('click', (e) => {
    const item = e.target.closest('[data-board]');
    if (!item || item.disabled) return;
    closeBoardMenus();
    const port = portSelect(role).value;
    if (item.dataset.board === 'rename') renameBoard(role, port);
    if (item.dataset.board === 'swap') {
      swapRoles();
      toast('⇄ As placas trocaram de lado.');
    }
    if (item.dataset.board === 'forget') {
      const label = boardLabel(port);
      forgetBoard(port);
      toast(`🧹 ${label} voltou a ser placa nova.`);
    }
  });
}
document.addEventListener('click', closeBoardMenus);

function renameBoard(role, port) {
  const dialog = $('board-name');
  const input = $('board-name-input');
  input.value = boardName(port);
  $('board-name-info').textContent = `Placa ${boardTag(port)} — ligada em ${port.replace('/dev/', '')}. Ela vai ser o ${ROLES[role].label}.`;
  dialog.returnValue = '';
  dialog.onclose = () => {
    if (dialog.returnValue !== 'ok') return;
    assignRole(role, port); // dar nome por este lado também define o papel
    setBoardName(port, input.value);
  };
  dialog.showModal();
  input.select();
}
$('board-name-cancel').addEventListener('click', () => $('board-name').close());

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
  resizeAll();
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
  closeBoardMenus();
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

function confirmReplace(what) {
  return !dirty || confirm(`${what}\n\nO projeto atual tem mudanças que não foram baixadas. Continuar mesmo assim?`);
}

function saveProject() {
  const state = projectState();
  download(`${fileSlug(state.nome)}${EXTENSION}`, serializeProject(state), 'application/json');
  dirty = false;
  log.summary(`💾 Projeto "${state.nome}" baixado (Controle + Carrinho).`, 'ok');
}

async function openProjectFile(file) {
  if (!file) return;
  try {
    const p = parseProject(await file.text());
    if (!confirmReplace(`Abrir "${file.name}"?`)) return;
    loadProject({ ...p, nome: p.nome || nameFromFile(file.name) });
    palette.refresh();
    log.summary(`📂 Projeto "${$('project-name').value}" aberto (Controle + Carrinho).`, 'ok');
  } catch (err) {
    alert(err.message || 'Não consegui abrir este arquivo.');
  }
}

const actions = {
  new() {
    if (!confirmReplace('Começar um projeto novo?')) return;
    loadProject(null);
    palette.refresh();
  },
  download() {
    const slug = fileSlug(projectState().nome);
    download(`${slug}-controle.ino`, cpp.sketch(workspaces.tx), 'text/plain');
    // Pequeno intervalo: alguns navegadores ignoram dois downloads no mesmo instante.
    setTimeout(() => download(`${slug}-carrinho.ino`, cpp.sketch(workspaces.rx), 'text/plain'), 300);
  },
  help() { $('help').showModal(); },
  release: () => releasePorts(),
};
document.querySelectorAll('#menu-list button').forEach((b) =>
  b.addEventListener('click', () => actions[b.dataset.action]()),
);

$('btn-save').addEventListener('click', saveProject);
$('btn-open').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  openProjectFile(file);
});

// Arrastar um .json para a janela abre o projeto.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  $('drop-hint').hidden = false;
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $('drop-hint').hidden = true;
  }
});
window.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault());
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('drop-hint').hidden = true;
  openProjectFile(e.dataTransfer.files[0]);
});

// Ctrl/Cmd+S baixa o projeto.
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveProject();
  }
});

// Para depuração no console do navegador.
window.rc = { workspaces, palette, cpp };
