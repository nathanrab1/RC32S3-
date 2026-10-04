// Configurações compartilhadas entre server.js e setup.js.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(SERVER_DIR, '..');
export const LIBRARY_DIR = path.join(ROOT_DIR, 'firmware-lib', 'RCLink');
export const WEB_DIST = path.join(ROOT_DIR, 'web', 'dist');

export const ESP32_INDEX_URL = 'https://espressif.github.io/arduino-esp32/package_esp32_index.json';
export const CORE = 'esp32:esp32';
// ESP32-S3 com USB nativa: CDCOnBoot faz o Serial sair pela USB-C da placa.
export const FQBN = 'esp32:esp32:esp32s3:CDCOnBoot=cdc';

const exe = process.platform === 'win32' ? 'arduino-cli.exe' : 'arduino-cli';
export const LOCAL_CLI = path.join(SERVER_DIR, 'bin', exe);

// Usa o arduino-cli da pasta bin/ (instalado pelo setup) ou o do sistema.
export function findCli() {
  if (existsSync(LOCAL_CLI)) return LOCAL_CLI;
  try {
    execFileSync(exe, ['version'], { stdio: 'ignore' });
    return exe;
  } catch {
    return null;
  }
}
