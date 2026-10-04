// Gera os dois .ino (Controle e Carrinho) de um arquivo de projeto.
// Uso: node scripts/project-to-ino.mjs <projeto.rc32s3.json> <pasta-de-saída>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as Blockly from 'blockly';
import { registerBlocks } from '../src/blocks/rc_blocks.js';
import { cpp } from '../src/generator/cpp.js';
import { parseProject } from '../src/project.js';

registerBlocks();
const [file, out = 'generated'] = process.argv.slice(2);
const project = parseProject(readFileSync(file, 'utf8'));
for (const [name, state] of [['Controle', project.controle], ['Carrinho', project.carrinho]]) {
  const ws = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(state, ws);
  const dir = path.join(out, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.ino`), cpp.sketch(ws));
  console.log(`✔ ${dir}/${name}.ino`);
}
