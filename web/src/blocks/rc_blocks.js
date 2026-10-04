// Definições dos blocos de radiocontrole (todos em português).
import * as Blockly from 'blockly';

export const COLORS = {
  programa: 45,
  radio: 200,
  controle: 290,
  carrinho: 15,
  leds: 60,
  tempo: 120,
  monitor: 160,
};

// ESP32-S3-Zero: GPIO 1..13 ficam nas barras laterais.
// Só GPIO 1..10 (ADC1) leem valores analógicos com o rádio ligado.
const DIGITAL_PINS = Array.from({ length: 13 }, (_, i) => [`GPIO ${i + 1}`, String(i + 1)]);
const ANALOG_PINS = DIGITAL_PINS.slice(0, 10);
const CHANNELS = Array.from({ length: 8 }, (_, i) => [`${i + 1}`, String(i + 1)]);
const SERVOS = [['direção', 'direcao'], ['extra', 'extra']];

export const BOARD_COLORS = [
  ['🔴 vermelho', '255,0,0'],
  ['🟢 verde', '0,255,0'],
  ['🔵 azul', '0,0,255'],
  ['🟡 amarelo', '255,180,0'],
  ['🟠 laranja', '255,80,0'],
  ['🟣 roxo', '160,0,255'],
  ['🩵 ciano', '0,200,255'],
  ['⚪ branco', '255,255,255'],
  ['⚫ desligado', '0,0,0'],
];

const pin = (name, analog = false) => ({
  type: 'field_dropdown',
  name,
  options: analog ? ANALOG_PINS : DIGITAL_PINS,
});

const statement = (extra) => ({ previousStatement: null, nextStatement: null, ...extra });
const hat = (extra) => ({
  message1: '%1',
  args1: [{ type: 'input_statement', name: 'DO' }],
  ...extra,
});

const definitions = [
  // ------------------------------------------------------------ Programa
  hat({
    type: 'rc_setup',
    message0: '⚡ ao ligar',
    colour: COLORS.programa,
    tooltip: 'Roda uma vez quando a placa liga.',
  }),
  hat({
    type: 'rc_loop',
    message0: '🔁 repetir sempre',
    colour: COLORS.programa,
    tooltip: 'Roda sem parar, o tempo todo, depois do "ao ligar".',
  }),
  hat({
    type: 'rc_every',
    message0: '⏱️ a cada %1 milissegundos',
    args0: [{ type: 'field_number', name: 'MS', value: 500, min: 1, precision: 1 }],
    colour: COLORS.programa,
    tooltip: 'Roda de tempos em tempos (1000 ms = 1 segundo).',
  }),

  // ------------------------------------------------------------ Rádio
  statement({
    type: 'rc_radio_begin',
    message0: '📡 ligar rádio na rede %1',
    args0: [{ type: 'field_number', name: 'NET', value: 1, min: 0, max: 65535, precision: 1 }],
    colour: COLORS.radio,
    tooltip: 'O controle e o carrinho precisam usar o MESMO número de rede.',
  }),
  statement({
    type: 'rc_send_channel',
    message0: 'enviar no canal %1 o valor %2',
    args0: [
      { type: 'field_dropdown', name: 'CH', options: CHANNELS },
      { type: 'input_value', name: 'VALUE', check: 'Number' },
    ],
    inputsInline: true,
    colour: COLORS.radio,
    tooltip: 'Envia um valor de -100 a 100. É repetido 50 vezes por segundo automaticamente.',
  }),
  statement({
    type: 'rc_send_message',
    message0: 'enviar mensagem %1 com valor %2',
    args0: [
      { type: 'field_input', name: 'NAME', text: 'farol' },
      { type: 'input_value', name: 'VALUE', check: ['Number', 'Boolean'] },
    ],
    inputsInline: true,
    colour: COLORS.radio,
    tooltip: 'Envia uma mensagem com nome uma vez (para eventos, como buzina ou farol).',
  }),
  {
    type: 'rc_channel',
    message0: 'valor do canal %1',
    args0: [{ type: 'field_dropdown', name: 'CH', options: CHANNELS }],
    output: 'Number',
    colour: COLORS.radio,
    tooltip: 'Valor recebido no canal, de -100 a 100. Vale 0 quando está sem sinal.',
  },
  hat({
    type: 'rc_on_message',
    message0: '📩 quando receber a mensagem %1',
    args0: [{ type: 'field_input', name: 'NAME', text: 'farol' }],
    colour: COLORS.radio,
    tooltip: 'Roda quando chegar uma mensagem com este nome.',
  }),
  {
    type: 'rc_message_value',
    message0: 'valor recebido',
    output: 'Number',
    colour: COLORS.radio,
    tooltip: 'O valor da mensagem. Só funciona dentro de "quando receber a mensagem".',
  },
  {
    type: 'rc_connected',
    message0: 'rádio conectado?',
    output: 'Boolean',
    colour: COLORS.radio,
    tooltip: 'Verdadeiro quando está recebendo sinal do outro ESP.',
  },
  {
    type: 'rc_signal',
    message0: 'força do sinal (%)',
    output: 'Number',
    colour: COLORS.radio,
    tooltip: 'De 0 (sem sinal) a 100 (muito perto).',
  },
  hat({
    type: 'rc_on_lost',
    message0: '⚠️ quando perder o sinal',
    colour: COLORS.radio,
    tooltip: 'O motor já para e os servos centralizam sozinhos. Use para avisar (LED, som...).',
  }),
  hat({
    type: 'rc_on_restored',
    message0: '✅ quando o sinal voltar',
    colour: COLORS.radio,
    tooltip: 'Roda quando a conexão volta (e também na primeira conexão).',
  }),

  // ------------------------------------------------------------ Controle (entradas)
  {
    type: 'rc_joystick',
    message0: '🕹️ joystick no pino %1 %2',
    args0: [
      pin('PIN', true),
      { type: 'field_dropdown', name: 'INV', options: [['normal', 'false'], ['invertido', 'true']] },
    ],
    output: 'Number',
    colour: COLORS.controle,
    tooltip: 'Posição de -100 a 100. O centro é medido quando a placa liga: não mexa no joystick nessa hora!',
  },
  {
    type: 'rc_pot',
    message0: '🎚️ potenciômetro no pino %1',
    args0: [pin('PIN', true)],
    output: 'Number',
    colour: COLORS.controle,
    tooltip: 'Valor de 0 a 100.',
  },
  {
    type: 'rc_button',
    message0: '🔘 botão no pino %1 apertado?',
    args0: [pin('PIN')],
    output: 'Boolean',
    colour: COLORS.controle,
    tooltip: 'Ligue o botão entre o pino e o GND.',
  },
  hat({
    type: 'rc_on_button',
    message0: '🔘 quando apertar o botão do pino %1',
    args0: [pin('PIN')],
    colour: COLORS.controle,
    tooltip: 'Roda uma vez a cada apertada. Ligue o botão entre o pino e o GND.',
  }),

  // ------------------------------------------------------------ Carrinho (atuadores)
  statement({
    type: 'rc_motor_setup',
    message0: '⚙️ configurar motor (ESC) no pino %1 tipo %2',
    args0: [
      pin('PIN'),
      { type: 'field_dropdown', name: 'KIND', options: [['com ré', 'true'], ['só para frente', 'false']] },
    ],
    colour: COLORS.carrinho,
    tooltip: 'ESC de carrinho normalmente é "com ré". ESC de drone/avião é "só para frente". O motor espera 3 s parado para armar.',
  }),
  statement({
    type: 'rc_motor_speed',
    message0: '🚗 motor velocidade %1 %%',
    args0: [{ type: 'input_value', name: 'VALUE', check: 'Number' }],
    inputsInline: true,
    colour: COLORS.carrinho,
    tooltip: 'De -100 (ré) a 100 (frente). 0 = parado.',
  }),
  statement({
    type: 'rc_motor_stop',
    message0: '🛑 parar motor',
    colour: COLORS.carrinho,
  }),
  statement({
    type: 'rc_servo_setup',
    message0: '⚙️ configurar servo %1 no pino %2 entre %3 ° e %4 °',
    args0: [
      { type: 'field_dropdown', name: 'SERVO', options: SERVOS },
      pin('PIN'),
      { type: 'field_number', name: 'MIN', value: 45, min: 0, max: 180, precision: 1 },
      { type: 'field_number', name: 'MAX', value: 135, min: 0, max: 180, precision: 1 },
    ],
    colour: COLORS.carrinho,
    tooltip: 'Os limites protegem a direção de forçar o servo. O centro fica no meio dos dois.',
  }),
  statement({
    type: 'rc_servo_position',
    message0: '↔️ servo %1 posição %2 %%',
    args0: [
      { type: 'field_dropdown', name: 'SERVO', options: SERVOS },
      { type: 'input_value', name: 'VALUE', check: 'Number' },
    ],
    inputsInline: true,
    colour: COLORS.carrinho,
    tooltip: 'De -100 (um lado) a 100 (outro lado). 0 = centro.',
  }),
  statement({
    type: 'rc_servo_angle',
    message0: '📐 servo %1 ângulo %2 °',
    args0: [
      { type: 'field_dropdown', name: 'SERVO', options: SERVOS },
      { type: 'input_value', name: 'VALUE', check: 'Number' },
    ],
    inputsInline: true,
    colour: COLORS.carrinho,
    tooltip: 'Ângulo de 0 a 180 graus (respeitando os limites configurados).',
  }),

  // ------------------------------------------------------------ LEDs
  statement({
    type: 'rc_led',
    message0: '💡 %1 LED do pino %2',
    args0: [
      { type: 'field_dropdown', name: 'STATE', options: [['ligar', 'true'], ['desligar', 'false']] },
      pin('PIN'),
    ],
    colour: COLORS.leds,
  }),
  statement({
    type: 'rc_led_toggle',
    message0: '💡 inverter LED do pino %1',
    args0: [pin('PIN')],
    colour: COLORS.leds,
    tooltip: 'Se está ligado, desliga. Se está desligado, liga.',
  }),
  statement({
    type: 'rc_board_led',
    message0: '🌈 LED da placa %1',
    args0: [{ type: 'field_dropdown', name: 'COLOR', options: BOARD_COLORS }],
    colour: COLORS.leds,
    tooltip: 'O LED colorido que já vem na ESP32-S3-Zero.',
  }),
  statement({
    type: 'rc_board_led_rgb',
    message0: '🌈 LED da placa vermelho %1 verde %2 azul %3',
    args0: [
      { type: 'input_value', name: 'R', check: 'Number' },
      { type: 'input_value', name: 'G', check: 'Number' },
      { type: 'input_value', name: 'B', check: 'Number' },
    ],
    inputsInline: true,
    colour: COLORS.leds,
    tooltip: 'Cada cor vai de 0 a 255.',
  }),

  // ------------------------------------------------------------ Tempo
  statement({
    type: 'rc_wait',
    message0: '⏳ esperar %1 milissegundos',
    args0: [{ type: 'input_value', name: 'MS', check: 'Number' }],
    inputsInline: true,
    colour: COLORS.tempo,
    tooltip: '1000 ms = 1 segundo. O rádio continua funcionando enquanto espera.',
  }),
  {
    type: 'rc_millis',
    message0: 'tempo desde que ligou (ms)',
    output: 'Number',
    colour: COLORS.tempo,
  },

  // ------------------------------------------------------------ Matemática extra
  {
    type: 'rc_map',
    message0: 'converter %1 de %2 a %3 para %4 a %5',
    args0: [
      { type: 'input_value', name: 'X', check: 'Number' },
      { type: 'input_value', name: 'IN_MIN', check: 'Number' },
      { type: 'input_value', name: 'IN_MAX', check: 'Number' },
      { type: 'input_value', name: 'OUT_MIN', check: 'Number' },
      { type: 'input_value', name: 'OUT_MAX', check: 'Number' },
    ],
    inputsInline: true,
    output: 'Number',
    colour: 230,
    tooltip: 'Converte um valor de uma faixa para outra. Ex: 0..100 para -100..100.',
  },

  // ------------------------------------------------------------ Monitor
  statement({
    type: 'rc_print',
    message0: '🖥️ mostrar no monitor %1',
    args0: [{ type: 'input_value', name: 'VALUE' }],
    inputsInline: true,
    colour: COLORS.monitor,
    tooltip: 'Mostra um valor ou texto no Monitor Serial (115200).',
  }),
];

// Nomes de mensagem: até 15 caracteres, sem aspas nem barra invertida.
function messageNameValidator(text) {
  const clean = text.replace(/["\\]/g, '').slice(0, 15);
  return clean.length ? clean : null;
}

export function registerBlocks() {
  Blockly.common.defineBlocksWithJsonArray(definitions);

  // Chapéus (início de programa/eventos) ganham o topo arredondado.
  for (const def of definitions.filter((d) => d.message1 === '%1')) {
    const block = Blockly.Blocks[def.type];
    const init = block.init;
    block.init = function () {
      init.call(this);
      this.hat = 'cap';
    };
  }

  for (const type of ['rc_send_message', 'rc_on_message']) {
    const block = Blockly.Blocks[type];
    const init = block.init;
    block.init = function () {
      init.call(this);
      this.getField('NAME').setValidator(messageNameValidator);
    };
  }

  // "valor recebido" só faz sentido dentro de "quando receber a mensagem".
  Blockly.Blocks['rc_message_value'].onchange = function () {
    if (this.isInFlyout) return;
    let parent = this.getSurroundParent();
    while (parent && parent.type !== 'rc_on_message') parent = parent.getSurroundParent();
    this.setWarningText(parent ? null : 'Use este bloco dentro de "quando receber a mensagem".');
  };
}
