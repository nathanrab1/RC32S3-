// Instala o que o gravador precisa: arduino-cli + suporte ao ESP32.
// Uso: npm run setup
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { CORE, ESP32_INDEX_URL, SERVER_DIR, findCli } from './common.js';

function step(msg) {
  console.log(`\n▶ ${msg}`);
}

function runOrExit(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`\n❌ Falhou: ${cmd} ${args.join(' ')}`);
    process.exit(1);
  }
}

let cli = findCli();

if (!cli) {
  step('Instalando o arduino-cli…');
  if (process.platform === 'win32') {
    console.log(
      'No Windows, baixe o arduino-cli em https://arduino.github.io/arduino-cli/latest/installation/\n' +
      `e coloque o arduino-cli.exe dentro de ${path.join(SERVER_DIR, 'bin')}. Depois rode "npm run setup" de novo.`,
    );
    process.exit(1);
  }
  const bin = path.join(SERVER_DIR, 'bin');
  mkdirSync(bin, { recursive: true });
  runOrExit('sh', ['-c', 'curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh'], {
    env: { ...process.env, BINDIR: bin },
  });
  cli = findCli();
  if (!cli) {
    console.error('❌ Não encontrei o arduino-cli depois da instalação.');
    process.exit(1);
  }
}
console.log(`✔ arduino-cli: ${cli}`);

step('Atualizando a lista de placas…');
runOrExit(cli, ['core', 'update-index', '--additional-urls', ESP32_INDEX_URL]);

step('Instalando o suporte ao ESP32 (pode demorar alguns minutos)…');
runOrExit(cli, ['core', 'install', CORE, '--additional-urls', ESP32_INDEX_URL]);

console.log('\n✅ Tudo pronto! Agora rode: npm start\n');
