// Gravador local do RC32S3.
//
// O app web (no GitHub Pages ou aqui mesmo em http://localhost:3232) envia
// o código C++ gerado pelos blocos; este servidor compila com o arduino-cli
// (junto com a biblioteca RCLink) e grava na ESP32-S3 pela USB.
//
// Rotas:
//   GET  /status   -> { pronto, arduinoCli, mensagem }
//   GET  /ports    -> [{ endereco, nome, esp32 }]
//   POST /compile  { code }        -> log em texto, termina com "@@RESULTADO ok|erro"
//   POST /upload   { code, port }  -> idem, compilando e gravando
//   GET  /monitor?port=...         -> saída do Monitor Serial (fica aberta)
//   POST /monitor/send { port, text } -> envia uma linha para a placa
//   POST /monitor/reset { port }      -> reinicia a placa
//   POST /serial/release              -> fecha TODA comunicação serial com as ESP32
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { CORE, FQBN, LIBRARY_DIR, WEB_DIST, findCli } from './common.js';
import * as monitor from './monitor.js';

const PORT = Number(process.env.PORT) || 3232;
const WORK_DIR = path.join(os.tmpdir(), 'rc32s3');
const SKETCH_DIR = path.join(WORK_DIR, 'sketch');
const BUILD_DIR = path.join(WORK_DIR, 'build');
const run = promisify(execFile);

let cli = findCli();
let building = false;

// ------------------------------------------------------------------ arduino-cli

async function cliJson(args) {
  const { stdout } = await run(cli, [...args, '--json'], { maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout);
}

let statusCache = null;
let statusAt = 0;

async function status() {
  if (statusCache && Date.now() - statusAt < 10000) return statusCache;
  cli = findCli();
  let result;
  if (!cli) {
    result = { pronto: false, mensagem: 'arduino-cli não encontrado. Rode "npm run setup".' };
  } else {
    try {
      const version = await cliJson(['version']);
      const cores = await cliJson(['core', 'list']);
      const list = Array.isArray(cores) ? cores : cores.platforms || [];
      const hasCore = list.some((p) => p.id === CORE);
      result = {
        pronto: hasCore,
        arduinoCli: version.VersionString || version.version_string || '',
        mensagem: hasCore ? 'ok' : 'Suporte ao ESP32 não instalado. Rode "npm run setup".',
      };
    } catch (err) {
      result = { pronto: false, mensagem: 'Erro ao consultar o arduino-cli: ' + err.message };
    }
  }
  statusCache = result;
  statusAt = Date.now();
  return result;
}

async function ports() {
  const data = await cliJson(['board', 'list']);
  const detected = Array.isArray(data) ? data : data.detected_ports || [];
  return detected
    .map((d) => d.port)
    .filter((p) => p && p.protocol === 'serial' && p.properties?.vid)
    .map((p) => {
      const esp32 = p.properties.vid.toLowerCase() === '0x303a'; // Espressif (USB nativa)
      return {
        endereco: p.address,
        nome: `${esp32 ? 'ESP32-S3' : 'USB'} — ${p.address.replace('/dev/', '')}`,
        esp32,
      };
    });
}

// ------------------------------------------------------------------ Compilar / gravar

const HINTS = [
  [/Failed to connect|No serial data received|could not open port/i,
    '💡 Dica: segure o botão BOOT da placa, aperte e solte RESET, solte o BOOT e tente gravar de novo.'],
  [/Resource busy|Permission denied|Access is denied/i,
    '💡 Dica: feche o Monitor Serial (ou outro programa) que esteja usando a porta USB.'],
  [/was not declared in this scope/i,
    '💡 Dica: algum bloco ficou incompleto ou fora do lugar. Confira os blocos com aviso (⚠️).'],
];

// Roda o arduino-cli repassando a saída para o navegador.
function runCli(res, args, onOutput) {
  return new Promise((resolve) => {
    const child = spawn(cli, args);
    const forward = (chunk) => {
      const text = chunk.toString();
      onOutput(text);
      res.write(text);
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('error', (err) => forward(Buffer.from(`Erro ao rodar o arduino-cli: ${err.message}\n`)));
    child.on('close', (code) => resolve(code === 0));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Encerra qualquer outro programa que esteja com a porta aberta (Monitor
// Serial do Arduino IDE, screen, etc.). Devolve os nomes do que foi fechado.
async function releasePort(port) {
  if (process.platform === 'win32' || !existsSync(port)) return [];
  let pids = [];
  try {
    const { stdout } = await run('lsof', ['-t', port]);
    pids = stdout.split('\n').map(Number).filter((pid) => pid && pid !== process.pid);
  } catch {
    return []; // lsof sai com erro quando ninguém está usando a porta
  }
  const closed = [];
  for (const pid of pids) {
    let name = String(pid);
    try {
      name = (await run('ps', ['-p', String(pid), '-o', 'comm='])).stdout.trim().split('/').pop() || name;
    } catch {
      /* processo já terminou */
    }
    // Navegadores não são encerrados (derrubaria todas as abas): só avisa.
    if (/chrome|google|safari|firefox|edge|brave|opera|electron/i.test(name)) {
      closed.push(`${name} — feche a aba que está usando a porta`);
      continue;
    }
    try {
      process.kill(pid, 'SIGTERM');
      closed.push(name);
    } catch {
      /* sem permissão ou já terminou */
    }
  }
  if (closed.length) await sleep(500);
  return closed;
}

async function releaseAllPorts() {
  const closedMonitors = await monitor.closeAll();
  const espPorts = (await ports().catch(() => [])).map((p) => p.endereco);
  const others = [];
  for (const port of espPorts) {
    for (const name of await releasePort(port)) others.push(`${name} (${port.replace('/dev/', '')})`);
  }
  return { monitores: closedMonitors, outros: others };
}

// Espera a porta USB existir (a placa pode estar reiniciando).
async function waitForPort(port, minWait = 300) {
  await sleep(minWait);
  for (let i = 0; i < 20 && process.platform !== 'win32' && !existsSync(port); i++) await sleep(250);
}

// Compila e, se pedido, grava. A gravação é um passo separado para que o
// Monitor Serial dessa porta só fique pausado durante a gravação em si.
async function build(res, { code, port }, upload) {
  mkdirSync(SKETCH_DIR, { recursive: true });
  mkdirSync(BUILD_DIR, { recursive: true });
  writeFileSync(path.join(SKETCH_DIR, 'sketch.ino'), code);

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.write('Compilando…\n');

  let output = '';
  const collect = (t) => (output += t);
  try {
    let ok = await runCli(
      res,
      ['compile', '--fqbn', FQBN, '--library', LIBRARY_DIR, '--build-path', BUILD_DIR, '--warnings', 'none', SKETCH_DIR],
      collect,
    );
    if (ok && upload) {
      res.write(`\nGravando em ${port}…\n`);
      // Nenhuma comunicação serial durante a gravação.
      await monitor.pauseAll();
      try {
        const closed = await releasePort(port);
        if (closed.length) res.write(`Fechei o que estava usando a porta: ${closed.join(', ')}\n`);
        const args = ['upload', '--fqbn', FQBN, '--port', port, '--input-dir', BUILD_DIR, SKETCH_DIR];
        await waitForPort(port);
        ok = await runCli(res, args, collect);
        // Porta ocupada ou sumida (placa reiniciando): espera e tenta mais uma vez.
        if (!ok && /port is busy|doesn't exist|Resource busy/i.test(output)) {
          res.write('\nA porta estava ocupada, tentando de novo…\n');
          output = '';
          await waitForPort(port, 3000);
          ok = await runCli(res, args, collect);
        }
      } finally {
        monitor.resumeAll(cli);
      }
    }
    if (!ok) {
      for (const [re, hint] of HINTS) if (re.test(output)) res.write(`\n${hint}\n`);
    }
    res.end(`\n@@RESULTADO ${ok ? 'ok' : 'erro'}\n`);
  } finally {
    building = false;
  }
}

// ------------------------------------------------------------------ HTTP

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Permite que o site no GitHub Pages fale com este servidor local (Chrome).
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 2_000_000) reject(new Error('Código grande demais'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.cur': 'image/x-icon',
};

// Serve o app web já compilado (web/dist), para usar sem internet.
function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let file = path.normalize(path.join(WEB_DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(WEB_DIST)) return false;
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!existsSync(file)) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
  return true;
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const route = new URL(req.url, 'http://localhost').pathname;

  try {
    if (req.method === 'GET' && route === '/status') return sendJson(res, 200, await status());

    if (req.method === 'GET' && route === '/ports') {
      if (!cli) return sendJson(res, 503, { erro: 'arduino-cli não encontrado' });
      return sendJson(res, 200, await ports());
    }

    if (req.method === 'GET' && route === '/monitor') {
      const port = new URL(req.url, 'http://localhost').searchParams.get('port');
      if (!cli) return sendJson(res, 503, { erro: 'arduino-cli não encontrado' });
      if (!port) return sendJson(res, 400, { erro: 'Porta não informada' });
      return monitor.attach(cli, port, req, res);
    }

    if (req.method === 'POST' && route === '/monitor/send') {
      const { port, text } = JSON.parse(await readBody(req));
      const ok = typeof port === 'string' && typeof text === 'string' && monitor.send(port, text);
      return sendJson(res, ok ? 200 : 409, { ok });
    }

    if (req.method === 'POST' && route === '/serial/release') {
      if (building) return sendJson(res, 409, { erro: 'Espere a gravação terminar.' });
      return sendJson(res, 200, await releaseAllPorts());
    }

    if (req.method === 'POST' && route === '/monitor/reset') {
      const { port } = JSON.parse(await readBody(req));
      if (typeof port !== 'string' || !port) return sendJson(res, 400, { erro: 'Porta não informada' });
      return sendJson(res, 200, { ok: await monitor.reset(cli, port) });
    }

    if (req.method === 'POST' && (route === '/compile' || route === '/upload')) {
      const upload = route === '/upload';
      const st = await status();
      if (!st.pronto) return sendJson(res, 503, { erro: st.mensagem });
      if (building) return sendJson(res, 409, { erro: 'Já estou gravando outro programa. Espere terminar.' });
      const { code, port } = JSON.parse(await readBody(req));
      if (typeof code !== 'string' || !code.includes('void setup')) {
        return sendJson(res, 400, { erro: 'Código inválido' });
      }
      if (upload && (typeof port !== 'string' || !port)) return sendJson(res, 400, { erro: 'Porta não informada' });
      building = true;
      return await build(res, { code, port }, upload);
    }

    if (req.method === 'GET' && serveStatic(req, res)) return;
    sendJson(res, 404, { erro: 'não encontrado' });
  } catch (err) {
    building = false;
    if (!res.headersSent) sendJson(res, 500, { erro: err.message });
    else res.end(`\n${err.message}\n@@RESULTADO erro\n`);
  }
});

// Só aceita conexões do próprio computador.
server.listen(PORT, '127.0.0.1', async () => {
  const st = await status();
  console.log(`\n🚗 Gravador do RC32S3 rodando em http://localhost:${PORT}`);
  if (existsSync(WEB_DIST)) console.log(`   App offline: abra http://localhost:${PORT} no Chrome`);
  console.log(st.pronto ? '   ✅ Pronto para gravar.' : `   ⚠️  ${st.mensagem}`);
  console.log('   Deixe esta janela aberta enquanto usa o app. Ctrl+C para sair.\n');
});
