// Monitor Serial compartilhado: um processo "arduino-cli monitor" por porta,
// com a saída repassada para todos os navegadores conectados.
//
// - Reconecta sozinho quando a placa reinicia ou é desconectada.
// - pause()/resume() liberam a porta durante a gravação.
//
// Na USB nativa da ESP32-S3, DTR/RTS controlam o boot e o reset do chip:
//   dtr=on,  rts=off -> abre a porta SEM reiniciar a placa (uso normal)
//   dtr=off, rts=on  -> reinicia a placa (botão "Reiniciar")
import { spawn } from 'node:child_process';

const BAUD = '115200';
const RETRY_MS = 1000;
const OPEN_CONFIG = `baudrate=${BAUD},dtr=on,rts=off`;
const RESET_CONFIG = `baudrate=${BAUD},dtr=off,rts=on`;

const monitors = new Map(); // porta -> { child, clients, paused, retryTimer, offline }
const IS_WINDOWS = process.platform === 'win32';

// O arduino-cli abre um subprocesso (serial-monitor) que é quem segura a
// porta. Rodando num grupo próprio, dá para encerrar os dois juntos.
function spawnMonitor(cli, port, config) {
  return spawn(cli, ['monitor', '-p', port, '--config', config, '--quiet'], { detached: !IS_WINDOWS });
}

function killTree(child) {
  try {
    if (!IS_WINDOWS) process.kill(-child.pid, 'SIGTERM');
    else child.kill();
  } catch {
    child.kill();
  }
}

function broadcast(m, text) {
  for (const res of m.clients) res.write(text);
}

function notice(m, text) {
  broadcast(m, `\n[gravador] ${text}\n`);
}

function start(cli, port, config = OPEN_CONFIG) {
  const m = monitors.get(port);
  if (!m || m.child || m.paused || m.clients.size === 0) return;

  const child = spawnMonitor(cli, port, config);
  m.child = child;
  let gotData = false;

  child.stdout.on('data', (chunk) => {
    if (!gotData && m.offline) notice(m, 'placa conectada');
    gotData = true;
    m.offline = false;
    broadcast(m, chunk.toString());
  });
  child.stderr.on('data', () => {}); // erros de "porta não encontrada" durante a reconexão
  child.on('error', () => {});
  child.on('close', () => {
    m.child = null;
    if (m.stopping) {
      m.stopping = false; // encerrado de propósito (reset ou gravação)
      return;
    }
    if (m.paused || m.clients.size === 0) return;
    if (!m.offline) {
      m.offline = true;
      notice(m, 'placa desconectada ou reiniciando… tentando de novo');
    }
    clearTimeout(m.retryTimer);
    m.retryTimer = setTimeout(() => start(cli, port), RETRY_MS);
  });
}

function stop(m) {
  clearTimeout(m.retryTimer);
  if (!m.child) return Promise.resolve();
  const child = m.child;
  m.stopping = true;
  return new Promise((resolve) => {
    child.once('close', resolve);
    killTree(child);
    setTimeout(resolve, 2000); // não trava a gravação se o processo demorar
  });
}

// GET /monitor?port=... : resposta em texto que fica aberta até o navegador fechar.
export function attach(cli, port, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  let m = monitors.get(port);
  if (!m) {
    m = { child: null, clients: new Set(), paused: false, retryTimer: null, offline: false };
    monitors.set(port, m);
  }
  m.clients.add(res);
  res.write(`[gravador] monitor de ${port.replace('/dev/', '')} (${BAUD} baud)\n`);
  if (m.paused) res.write('[gravador] gravando… o monitor volta sozinho\n');
  start(cli, port);

  req.on('close', () => {
    m.clients.delete(res);
    if (m.clients.size === 0 && monitors.get(port) === m) {
      stop(m);
      monitors.delete(port);
    }
  });
}

export function send(port, text) {
  const m = monitors.get(port);
  if (!m?.child) return false;
  m.child.stdin.write(text + '\n');
  return true;
}

// Reinicia a placa. Com o monitor aberto, a saída do boot aparece nele.
export async function reset(cli, port) {
  const m = monitors.get(port);
  if (m && !m.paused) {
    notice(m, 'reiniciando a placa…');
    await stop(m);
    start(cli, port, RESET_CONFIG);
    return true;
  }
  if (m?.paused) return false;
  // Sem monitor aberto: abre rapidinho só para dar o reset.
  const child = spawnMonitor(cli, port, RESET_CONFIG);
  child.on('error', () => {});
  setTimeout(() => killTree(child), 500);
  return true;
}

// Gravação: pausa os monitores de TODAS as portas (nenhuma comunicação
// serial durante a gravação) e retoma depois.
export async function pauseAll() {
  const paused = [];
  for (const [port, m] of monitors) {
    m.paused = true;
    notice(m, 'gravando… o monitor volta sozinho');
    paused.push(stop(m));
  }
  await Promise.all(paused);
}

export function resumeAll(cli) {
  for (const [port, m] of monitors) {
    m.paused = false;
    m.offline = true; // a placa gravada reinicia
    // Espera a USB da placa reaparecer depois do reset.
    clearTimeout(m.retryTimer);
    m.retryTimer = setTimeout(() => start(cli, port), 1500);
  }
}

// Fecha os monitores e avisa os navegadores para não reconectarem.
export async function closeAll() {
  const closing = [];
  for (const [port, m] of monitors) {
    notice(m, 'porta fechada');
    for (const res of m.clients) res.end('@@FECHADO\n');
    m.clients.clear();
    closing.push(stop(m));
    monitors.delete(port);
  }
  await Promise.all(closing);
  return closing.length;
}

export function activePorts() {
  return [...monitors.keys()];
}
