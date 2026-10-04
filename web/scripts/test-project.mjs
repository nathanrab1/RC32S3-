// Teste do arquivo de projeto: salvar e abrir de novo mantém o PAR
// (Controle + Carrinho) idêntico, e arquivos incompletos são recusados.
import assert from 'node:assert/strict';
import * as Blockly from 'blockly';
import { registerBlocks } from '../src/blocks/rc_blocks.js';
import { cpp } from '../src/generator/cpp.js';
import { defaultTx, defaultRx } from '../src/toolbox.js';
import { serializeProject, parseProject, fileSlug, nameFromFile } from '../src/project.js';

registerBlocks();

function workspaceFrom(state) {
  const ws = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(state, ws);
  return ws;
}

// Ida e volta.
const tx = workspaceFrom(defaultTx);
const rx = workspaceFrom(defaultRx);
const text = serializeProject({
  nome: 'Olá Mundo',
  controle: Blockly.serialization.workspaces.save(tx),
  carrinho: Blockly.serialization.workspaces.save(rx),
});
const data = JSON.parse(text);
assert.equal(data.formato, 'rc32s3');
assert.ok(data.controle && data.carrinho, 'o arquivo guarda os dois programas');

const back = parseProject(text);
assert.equal(back.nome, 'Olá Mundo');
assert.equal(cpp.sketch(workspaceFrom(back.controle)), cpp.sketch(tx), 'Controle igual depois de abrir');
assert.equal(cpp.sketch(workspaceFrom(back.carrinho)), cpp.sketch(rx), 'Carrinho igual depois de abrir');
console.log('✔ salvar e abrir mantém Controle e Carrinho');

// Arquivos inválidos.
const rejects = (input, pattern, label) => {
  assert.throws(() => parseProject(input), pattern, label);
  console.log(`✔ recusa: ${label}`);
};
rejects('não é json', /não é um JSON/, 'texto qualquer');
rejects(JSON.stringify({ formato: 'outro', controle: {}, carrinho: {} }), /não é um projeto/, 'outro formato');
rejects(JSON.stringify({ formato: 'rc32s3', versao: 2, controle: {} }), /falta o programa do carrinho/, 'sem o carrinho');
rejects(JSON.stringify({ formato: 'rc32s3', versao: 2, carrinho: {} }), /falta o programa do controle/, 'sem o controle');
rejects(JSON.stringify({ formato: 'rc32s3', versao: 99, controle: {}, carrinho: {} }), /versão mais nova/, 'versão futura');

// Projetos antigos continuam abrindo.
assert.ok(parseProject(JSON.stringify({ formato: 'blockly-rc', versao: 1, controle: {}, carrinho: {} })));
console.log('✔ abre projetos do formato antigo');

assert.equal(fileSlug('Meu Carrinho Ação!'), 'meu-carrinho-acao');
assert.equal(nameFromFile('pista-1.rc32s3.json'), 'pista-1');
console.log('✔ nomes de arquivo');
