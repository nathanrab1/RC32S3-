// Painel do Monitor Serial: duas colunas, uma para cada ESP.
// A leitura da porta é feita pelo gravador local (rota /monitor), que pausa
// o monitor sozinho enquanto grava.
import { SERVER_URL } from './uploader.js';

const MAX_CHARS = 200_000;
const PORT_KEY = 'rc.ports'; // { tx: porta, rx: porta } da última gravação

const ROLE_LABEL = { tx: '🎮 Controle', rx: '🚗 Carrinho' };

let ports = [];
let roles = loadRoles();
const columns = [];
let open = false;

function loadRoles() {
  try {
    return JSON.parse(localStorage.getItem(PORT_KEY)) || {};
  } catch {
    return {};
  }
}

function roleOf(port) {
  return Object.keys(ROLE_LABEL).find((r) => roles[r] === port);
}

function shortName(port) {
  return port.replace('/dev/', '').replace('cu.', '');
}

// ------------------------------------------------------------------ Coluna

function createColumn(container) {
  const el = document.createElement('div');
  el.className = 'mon';
  el.innerHTML = `
    <header class="mon-head">
      <span class="mon-title"></span>
      <select class="mon-port" title="Porta da placa"></select>
      <label class="mon-check" title="Acompanhar as mensagens novas"><input type="checkbox" checked /> rolar</label>
      <button class="btn ghost mon-power" title="Fechar ou abrir a comunicação com esta placa"></button>
      <button class="btn ghost icon mon-reset" title="Reiniciar a placa (mostra as mensagens do começo)">🔁</button>
      <button class="btn ghost icon mon-clear" title="Limpar">🧹</button>
    </header>
    <pre class="mon-out"></pre>
    <form class="mon-send">
      <input type="text" placeholder="Enviar para a placa…" autocomplete="off" />
      <button class="btn">Enviar</button>
    </form>`;
  container.append(el);

  const col = {
    el,
    title: el.querySelector('.mon-title'),
    select: el.querySelector('.mon-port'),
    out: el.querySelector('.mon-out'),
    follow: el.querySelector('input[type=checkbox]'),
    power: el.querySelector('.mon-power'),
    port: '',
    abort: null,
    closed: false,
  };
  renderPower(col);

  col.select.addEventListener('change', () => setPort(col, col.select.value));
  col.power.addEventListener('click', () => setClosed(col, !col.closed));
  el.querySelector('.mon-clear').addEventListener('click', () => (col.out.textContent = ''));
  el.querySelector('.mon-reset').addEventListener('click', async () => {
    if (!col.port) return;
    try {
      await fetch(`${SERVER_URL}/monitor/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: col.port }),
      });
    } catch {
      append(col, '\n[monitor] não consegui reiniciar a placa\n');
    }
  });
  el.querySelector('.mon-send').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    if (!col.port || !input.value) return;
    const text = input.value;
    input.value = '';
    try {
      await fetch(`${SERVER_URL}/monitor/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: col.port, text }),
      });
    } catch {
      append(col, '\n[gravador] não consegui enviar\n');
    }
  });
  return col;
}

function append(col, text) {
  const out = col.out;
  out.textContent += text;
  if (out.textContent.length > MAX_CHARS) out.textContent = out.textContent.slice(-MAX_CHARS / 2);
  if (col.follow.checked) out.scrollTop = out.scrollHeight;
}

function renderTitle(col) {
  const role = roleOf(col.port);
  col.title.textContent = col.port ? (role ? ROLE_LABEL[role] : '🔌 ESP32') : '— sem placa —';
  col.el.dataset.role = role || '';
}

function renderOptions(col) {
  const options = ['<option value="">— escolha a placa —</option>'];
  const list = ports.some((p) => p.endereco === col.port) || !col.port ? ports : [...ports, { endereco: col.port }];
  for (const p of list) {
    const role = roleOf(p.endereco);
    const label = `${shortName(p.endereco)}${role ? ' · ' + ROLE_LABEL[role].slice(3) : ''}`;
    options.push(`<option value="${p.endereco}">${label}</option>`);
  }
  col.select.innerHTML = options.join('');
  col.select.value = col.port;
}

function renderPower(col) {
  col.power.textContent = col.closed ? '▶ Abrir' : '⏹ Fechar';
  col.el.classList.toggle('closed', col.closed);
}

function setClosed(col, closed) {
  col.closed = closed;
  renderPower(col);
  if (closed) {
    disconnect(col);
    append(col, '\n[monitor] porta fechada — pode gravar à vontade\n');
  } else {
    connect(col);
  }
}

function disconnect(col) {
  col.abort?.abort();
  col.abort = null;
}

async function connect(col) {
  disconnect(col);
  if (!col.port || !open || col.closed) return;
  const abort = new AbortController();
  col.abort = abort;
  try {
    const res = await fetch(`${SERVER_URL}/monitor?port=${encodeURIComponent(col.port)}`, { signal: abort.signal });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.includes('@@FECHADO')) {
        // O gravador fechou todas as portas: não reconecta.
        append(col, value.replace(/@@FECHADO\n?/g, ''));
        col.abort = null;
        col.closed = true;
        renderPower(col);
        return;
      }
      append(col, value);
    }
  } catch (err) {
    if (abort.signal.aborted) return;
  }
  // Conexão caiu (gravador desligado?): tenta de novo em alguns segundos.
  if (col.abort === abort) {
    append(col, '\n[monitor] sem conexão com o gravador… tentando de novo\n');
    setTimeout(() => col.abort === abort && connect(col), 3000);
  }
}

function setPort(col, port) {
  if (col.port === port) return;
  col.port = port;
  col.out.textContent = '';
  renderTitle(col);
  renderOptions(col);
  connect(col);
}

// Escolhe as portas iniciais: Controle à esquerda, Carrinho à direita.
function autoAssign() {
  const available = ports.map((p) => p.endereco);
  const used = new Set(columns.map((c) => c.port).filter(Boolean));
  const preferred = [roles.tx, roles.rx];
  columns.forEach((col, i) => {
    if (col.port && available.includes(col.port)) return;
    const pick =
      (available.includes(preferred[i]) && !used.has(preferred[i]) && preferred[i]) ||
      available.find((p) => !used.has(p) && !preferred.includes(p)) ||
      available.find((p) => !used.has(p));
    if (pick && !col.port) {
      used.add(pick);
      setPort(col, pick);
    }
  });
}

// ------------------------------------------------------------------ API

export function initMonitor() {
  const container = document.getElementById('monitor-cols');
  columns.push(createColumn(container), createColumn(container));
  columns.forEach((c) => {
    renderTitle(c);
    renderOptions(c);
  });
}

export function toggleMonitor(force) {
  open = force ?? !open;
  document.getElementById('monitor').hidden = !open;
  document.getElementById('btn-monitor').classList.toggle('active', open);
  if (open) {
    autoAssign();
    columns.forEach((c) => {
      c.closed = false;
      renderPower(c);
      connect(c);
    });
  } else {
    columns.forEach(disconnect);
  }
  return open;
}

export function updatePorts(list) {
  ports = list.filter((p) => p.esp32).length ? list.filter((p) => p.esp32) : list;
  columns.forEach(renderOptions);
  if (open) autoAssign();
}

// Chamado depois de gravar: lembra qual porta é o Controle e qual é o Carrinho.
export function rememberPort(role, port) {
  for (const r of Object.keys(roles)) if (roles[r] === port) delete roles[r];
  roles[role] = port;
  try {
    localStorage.setItem(PORT_KEY, JSON.stringify(roles));
  } catch {
    /* sem armazenamento: só não lembra entre sessões */
  }
  columns.forEach((c) => {
    renderTitle(c);
    renderOptions(c);
  });
}

// Fecha TODA comunicação serial com as placas (monitores deste app e
// outros programas, como o Monitor Serial do Arduino IDE).
export async function releaseAll() {
  const res = await fetch(`${SERVER_URL}/serial/release`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.erro || 'erro');
  columns.forEach((c) => {
    disconnect(c);
    c.closed = true;
    renderPower(c);
  });
  return data;
}
