// Gera o C++ dos programas iniciais (Controle e Carrinho) sem navegador.
// Uso: node scripts/generate-examples.mjs <pasta-de-saída>
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as Blockly from 'blockly';
import { registerBlocks } from '../src/blocks/rc_blocks.js';
import { cpp } from '../src/generator/cpp.js';
import { defaultTx, defaultRx } from '../src/toolbox.js';

registerBlocks();
const out = process.argv[2] || 'generated';

for (const [name, state] of [['Controle', defaultTx], ['Carrinho', defaultRx]]) {
  const ws = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(state, ws);
  const dir = path.join(out, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.ino`), cpp.sketch(ws));
  console.log(`✔ ${dir}/${name}.ino`);
}
