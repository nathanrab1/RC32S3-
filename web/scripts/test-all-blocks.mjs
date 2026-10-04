// Teste: coloca TODOS os blocos de cada toolbox num programa, gera o C++
// e grava em <pasta>/Todos_<aba>/. Depois compile com o arduino-cli.
// Uso: node scripts/test-all-blocks.mjs <pasta-de-saída>
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as Blockly from 'blockly';
import { registerBlocks } from '../src/blocks/rc_blocks.js';
import { cpp } from '../src/generator/cpp.js';
import { toolboxTx, toolboxRx } from '../src/toolbox.js';

registerBlocks();
const out = process.argv[2] || 'generated';
let failures = 0;

function items(toolbox) {
  return toolbox.contents.flatMap((c) => c.contents || []).filter((i) => i.kind === 'block');
}

for (const [name, toolbox] of [['TX', toolboxTx], ['RX', toolboxRx]]) {
  const ws = new Blockly.Workspace();
  const v = ws.getVariableMap().createVariable('velocidade');
  ws.getVariableMap().createVariable('direção');
  const setup = ws.newBlock('rc_setup');
  const loop = ws.newBlock('rc_loop');
  let tail = loop.getInput('DO').connection;

  const attach = (block) => {
    tail.connect(block.previousConnection);
    tail = block.nextConnection;
  };

  // Configurações necessárias primeiro.
  let st = setup.getInput('DO').connection;
  for (const t of ['rc_radio_begin', 'rc_motor_setup', 'rc_servo_setup']) {
    const b = ws.newBlock(t);
    st.connect(b.previousConnection);
    st = b.nextConnection;
  }
  const extra = ws.newBlock('rc_servo_setup');
  extra.setFieldValue('extra', 'SERVO');
  st.connect(extra.previousConnection);

  for (const item of items(toolbox)) {
    const { kind, ...state } = item;
    if (state.type === 'variables_get' || state.type === 'variables_set') continue;
    if (state.type === 'controls_for' || state.type === 'math_change') state.fields = { VAR: { id: v.getId() } };
    let block;
    try {
      block = Blockly.serialization.blocks.append(state, ws);
    } catch (e) {
      console.error(`✖ ${state.type}: ${e.message}`);
      failures++;
      continue;
    }
    if (block.previousConnection && !block.nextConnection) {
      // "interromper/continuar" só existe dentro de um laço.
      const rep = ws.newBlock('controls_repeat_ext');
      rep.getInput('DO').connection.connect(block.previousConnection);
      attach(rep);
    } else if (block.previousConnection) {
      attach(block);
    } else if (block.outputConnection) {
      const set = ws.newBlock('variables_set');
      set.setFieldValue(v.getId(), 'VAR');
      set.getInput('VALUE').connection.connect(block.outputConnection);
      // "valor recebido" precisa estar dentro de "quando receber mensagem/canal".
      if (state.type === 'rc_message_value') {
        const hat = ws.newBlock('rc_on_message');
        hat.setFieldValue('teste', 'NAME');
        hat.getInput('DO').connection.connect(set.previousConnection);
        if (toolbox === toolboxRx) {
          const chHat = ws.newBlock('rc_on_channel');
          chHat.setFieldValue('3', 'CH');
          const set2 = ws.newBlock('variables_set');
          set2.setFieldValue(v.getId(), 'VAR');
          set2.getInput('VALUE').connection.connect(ws.newBlock('rc_message_value').outputConnection);
          chHat.getInput('DO').connection.connect(set2.previousConnection);
        }
      } else {
        attach(set);
      }
    } else {
      // Chapéu: põe um bloco dentro para não ficar vazio.
      const print = ws.newBlock('rc_print');
      block.getInput('DO').connection.connect(print.previousConnection);
    }
  }

  const dir = path.join(out, `Todos_${name}`);
  mkdirSync(dir, { recursive: true });
  const code = cpp.sketch(ws);
  writeFileSync(path.join(dir, `Todos_${name}.ino`), code);
  if (name === 'RX') {
    const ok = /RCLink\.onChannel\(3, canal_3\);/.test(code) && /void canal_3\(float valorRecebido\) \{\n  velocidade = valorRecebido;/.test(code);
    if (!ok) {
      console.error('✖ "quando receber o canal" não gerou o código esperado');
      failures++;
    }
  }
  console.log(`✔ ${dir}`);
}
process.exit(failures ? 1 : 0);
