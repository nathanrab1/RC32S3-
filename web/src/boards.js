// Placas conhecidas: cada ESP32-S3 informa pela USB um número de série
// único (o endereço MAC). Guardamos qual placa é o Controle e qual é o
// Carrinho por esse número, então o nome continua certo mesmo se a porta
// USB (/dev/cu.usbmodem…) mudar.

export const ROLE_LABEL = { tx: '🎮 Controle', rx: '🚗 Carrinho' };

const KEY = 'rc.boards'; // { [serial]: 'tx' | 'rx' }
const LEGACY_KEY = 'rc.ports'; // versão antiga: { tx: porta, rx: porta }

let bySerial = read(KEY) || {};
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
  } catch {
    /* sem armazenamento: só não lembra entre sessões */
  }
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
  for (const fn of listeners) fn();
}

export function onBoardsChange(fn) {
  listeners.add(fn);
}

// "🎮 Controle", "🚗 Carrinho" ou "🔌 Placa nova (EA:7C)".
export function boardLabel(port) {
  const role = roleOfPort(port);
  if (role) return ROLE_LABEL[role];
  const info = ports.find((p) => p.endereco === port);
  if (info?.serial) return `🔌 Placa nova (${info.serial.slice(-5)})`;
  return `🔌 ${port.replace('/dev/', '').replace('cu.', '')}`;
}
