// Placas conhecidas: cada ESP32-S3 informa pela USB um número de série
// único (o endereço MAC). Guardamos qual placa é o Controle e qual é o
// Carrinho por esse número, então o nome continua certo mesmo se a porta
// USB (/dev/cu.usbmodem…) mudar. Cada placa também pode ganhar um apelido
// ("Azul", "Grupo 3"), útil numa sala com muitas placas iguais.

export const ROLE_LABEL = { tx: '🎮 Controle', rx: '🚗 Carrinho' };

const KEY = 'rc.boards'; // { [serial]: 'tx' | 'rx' }
const NAMES_KEY = 'rc.boardNames'; // { [serial]: 'Azul' }
const LEGACY_KEY = 'rc.ports'; // versão antiga: { tx: porta, rx: porta }
export const NAME_MAX = 24;

let bySerial = read(KEY) || {};
let names = read(NAMES_KEY) || {};
let ports = []; // última lista do gravador: [{ endereco, esp32, serial }]
const listeners = new Set();

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(bySerial));
    localStorage.setItem(NAMES_KEY, JSON.stringify(names));
  } catch {
    /* sem armazenamento: só não lembra entre sessões */
  }
  for (const fn of listeners) fn();
}

const serialOf = (port) => ports.find((p) => p.endereco === port)?.serial || '';

export function setPorts(list) {
  ports = list;
  // Converte o que a versão antiga lembrava (por porta) para número de série.
  const legacy = read(LEGACY_KEY);
  if (legacy && !Object.keys(bySerial).length) {
    for (const role of Object.keys(ROLE_LABEL)) {
      const serial = serialOf(legacy[role]);
      if (serial) bySerial[serial] = role;
    }
    save();
  }
}

export function roleOfPort(port) {
  const serial = serialOf(port);
  return serial ? bySerial[serial] || null : null;
}

export function portForRole(role) {
  return ports.find((p) => p.serial && bySerial[p.serial] === role)?.endereco || '';
}

// Esta placa passa a ser o Controle/Carrinho (só uma placa por papel).
export function assignRole(role, port) {
  const serial = serialOf(port);
  if (!serial || bySerial[serial] === role) return;
  for (const s of Object.keys(bySerial)) if (bySerial[s] === role) delete bySerial[s];
  bySerial[serial] = role;
  save();
}

// Controle vira Carrinho e vice-versa (mesmo que só uma esteja ligada).
export function swapRoles() {
  for (const s of Object.keys(bySerial)) bySerial[s] = bySerial[s] === 'tx' ? 'rx' : 'tx';
  save();
}

export function hasRoles() {
  return Object.keys(bySerial).length > 0;
}

export function boardName(port) {
  return names[serialOf(port)] || '';
}

// Apelido da placa (vazio = tira o apelido).
export function setBoardName(port, name) {
  const serial = serialOf(port);
  if (!serial) return;
  const clean = String(name || '').trim().slice(0, NAME_MAX);
  if (clean) names[serial] = clean;
  else delete names[serial];
  save();
}

// A placa volta a ser "placa nova": sem papel e sem apelido.
export function forgetBoard(port) {
  const serial = serialOf(port);
  if (!serial) return;
  delete bySerial[serial];
  delete names[serial];
  save();
}

// Final do número de série ("EA:7C"), para diferenciar placas iguais.
export function boardTag(port) {
  return serialOf(port).slice(-5);
}

export function onBoardsChange(fn) {
  listeners.add(fn);
}

// "🎮 Controle", "🚗 Carrinho · Azul", "🔌 Azul" ou "🔌 Placa nova (EA:7C)".
// O papel vem sempre primeiro: o apelido acompanha a placa se ela trocar de lado.
export function boardLabel(port) {
  const role = roleOfPort(port);
  const name = boardName(port);
  if (role) return name ? `${ROLE_LABEL[role]} · ${name}` : ROLE_LABEL[role];
  if (name) return `🔌 ${name}`;
  if (serialOf(port)) return `🔌 Placa nova (${boardTag(port)})`;
  return `🔌 ${port.replace('/dev/', '').replace('cu.', '')}`;
}
