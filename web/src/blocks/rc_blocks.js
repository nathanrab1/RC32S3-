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
// O que um canal pode controlar sozinho no carrinho (bloco "canal controla").
export const LINK_TARGETS = [
  ['🚗 motor (velocidade %)', 'motor'],
  ['↔️ servo direção (posição %)', 'direcao:position'],
  ['📐 servo direção (ângulo °)', 'direcao:angle'],
  ['↔️ servo extra (posição %)', 'extra:position'],
  ['📐 servo extra (ângulo °)', 'extra:angle'],
];

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
    tooltip: 'Envia um número (para motor e servo, use de -100 a 100). É repetido 50 vezes por segundo automaticamente.',
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
    type: 'rc_link_channel',
    message0: '🔗 canal %1 controla %2',
    args0: [
      { type: 'field_dropdown', name: 'CH', options: CHANNELS },
      { type: 'field_dropdown', name: 'TARGET', options: LINK_TARGETS },
    ],
    colour: COLORS.radio,
    tooltip:
      'Solte este bloco em qualquer lugar: o valor que chega no canal vai direto para o motor ou servo. ' +
      'Motor e posição: de -100 a 100. Ângulo: de 0 a 180. Configure o motor/servo no "ao ligar".',
  },
  {
    type: 'rc_channel',
    message0: 'valor do canal %1',
    args0: [{ type: 'field_dropdown', name: 'CH', options: CHANNELS }],
    output: 'Number',
    colour: COLORS.radio,
    tooltip: 'Último número recebido no canal. Vale 0 quando está sem sinal.',
  },
  hat({
    type: 'rc_on_message',
    message0: '📩 quando receber a mensagem %1',
    args0: [{ type: 'field_input', name: 'NAME', text: 'farol' }],
    colour: COLORS.radio,
    tooltip: 'Roda quando chegar uma mensagem com este nome.',
  }),
  hat({
    type: 'rc_on_channel',
    message0: '📶 quando receber o canal %1',
    args0: [{ type: 'field_dropdown', name: 'CH', options: CHANNELS }],
    colour: COLORS.radio,
    tooltip: 'Roda a cada vez que o valor do canal chega (até 50 vezes por segundo). Use "valor do canal" para pegar o número.',
  }),
  {
    type: 'rc_message_value',
    message0: 'valor recebido',
    output: 'Number',
    colour: COLORS.radio,
    tooltip: 'O valor que chegou no canal. Use dentro de "quando receber o canal".',
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
    tooltip: 'Posição de -100 a 100. O centro é medido quando a placa liga (não mexa no joystick nessa hora). Depois, mova até as pontas uma vez para ele aprender o curso do seu joystick.',
  },
  {
    type: 'rc_pot',
    message0: '🎚️ potenciômetro no pino %1',
    args0: [pin('PIN', true)],
    output: 'Number',
    colour: COLORS.controle,
    tooltip: 'Valor de 0 a 100. Depois de ligar, gire de ponta a ponta uma vez para ele aprender o seu potenciômetro.',
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

export const RECEIVING_EVENTS = ['rc_on_message', 'rc_on_channel'];

// O evento ("quando receber…") que envolve o bloco, se houver.
export function receivingEvent(block) {
  let parent = block.getSurroundParent();
  while (parent && !RECEIVING_EVENTS.includes(parent.type)) parent = parent.getSurroundParent();
  return parent;
}

// ------------------------------------------------------------------ "juntar" em uma linha

const BUTTON_SVG = (sign) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#fff" fill-opacity=".9"/>` +
      `<path d="M5.5 10h9${sign === '+' ? 'M10 5.5v9' : ''}" stroke="#2f7d62" stroke-width="2.6" stroke-linecap="round"/></svg>`,
  );

// Bloco com uma lista de entradas (ADD0..ADDn-1) que cresce e diminui pelos
// botões ➕/➖ no fim. Cada entrada nova já vem com um "shadow" para digitar
// (sem entrar no histórico: quem desfaz/refaz é o evento de "mutation").
function listBlock({ setup, shadow, check = null, label = null, max = Infinity }) {
  const inputName = (i) => 'ADD' + i;
  return {
    init() {
      this.itemCount = 2;
      setup.call(this);
      this.updateShape_();
    },

    saveExtraState() {
      return { itemCount: this.itemCount };
    },

    loadExtraState(state) {
      this.itemCount = Math.min(max, Math.max(1, Number(state?.itemCount) || 1));
      this.updateShape_();
    },

    updateShape_() {
      if (this.getInput('BUTTONS')) this.removeInput('BUTTONS');
      for (let i = 0; i < this.itemCount; i++) {
        if (this.getInput(inputName(i))) continue;
        const input = this.appendValueInput(inputName(i)).setCheck(check);
        if (label) input.appendField(label(i));
        Blockly.Events.disable();
        try {
          input.connection.setShadowState(shadow);
        } finally {
          Blockly.Events.enable();
        }
      }
      for (let i = this.itemCount; this.getInput(inputName(i)); i++) {
        const input = this.getInput(inputName(i));
        const target = input.connection.targetBlock();
        if (target && !target.isShadow()) target.unplug(); // não perde o bloco do aluno
        Blockly.Events.disable();
        try {
          input.connection.setShadowState(null);
          this.removeInput(inputName(i));
        } finally {
          Blockly.Events.enable();
        }
      }
      const buttons = this.appendDummyInput('BUTTONS');
      if (this.itemCount > 1) {
        buttons.appendField(new Blockly.FieldImage(BUTTON_SVG('-'), 18, 18, '−', (f) => f.getSourceBlock().resize_(-1)));
      }
      if (this.itemCount < max) {
        buttons.appendField(new Blockly.FieldImage(BUTTON_SVG('+'), 18, 18, '+', (f) => f.getSourceBlock().resize_(+1)));
      }
    },

    resize_(delta) {
      const next = this.itemCount + delta;
      if (next < 1 || next > max) return;
      Blockly.Events.setGroup(true);
      try {
        if (delta < 0) {
          // Bloco do aluno no último pedaço sai antes (e volta ao desfazer).
          const target = this.getInput(inputName(next))?.connection.targetBlock();
          if (target && !target.isShadow()) {
            target.unplug();
            target.bumpNeighbours?.();
          }
        }
        const before = JSON.stringify(this.saveExtraState());
        this.itemCount = next;
        Blockly.Events.fire(new Blockly.Events.BlockChange(this, 'mutation', null, before, JSON.stringify(this.saveExtraState())));
        this.updateShape_();
      } finally {
        Blockly.Events.setGroup(false);
      }
    },
  };
}

// Junta textos e números numa linha só. Os pedaços ficam lado a lado e os
// botões ➕/➖ no fim acrescentam/tiram pedaços à direita.
const RC_JOIN = listBlock({
  shadow: { type: 'text', fields: { TEXT: '' } },
  setup() {
    this.setStyle('text_blocks');
    this.setOutput(true, 'String');
    this.setInputsInline(true);
    this.setTooltip('Junta textos e números numa linha só. ➕ acrescenta um pedaço, ➖ tira o último.');
    this.appendDummyInput('TITLE').appendField('juntar');
  },
});

// Envia vários canais num bloco só: uma linha por canal (1, 2, 3...).
const RC_SEND_CHANNELS = listBlock({
  shadow: { type: 'math_number', fields: { NUM: 0 } },
  check: 'Number',
  label: (i) => `canal ${i + 1}`,
  max: CHANNELS.length,
  setup() {
    this.setColour(COLORS.radio);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setInputsInline(false);
    this.setTooltip(
      'Envia vários canais de uma vez, um por linha. ➕ acrescenta o próximo canal, ➖ tira o último. ' +
        'Coloque dentro do "repetir sempre". Para motor e servo, use de -100 a 100.',
    );
    this.appendDummyInput('TITLE').appendField('📡 enviar canais');
  },
});

// Nomes de mensagem: até 15 caracteres, sem aspas nem barra invertida.
function messageNameValidator(text) {
  const clean = text.replace(/["\\]/g, '').slice(0, 15);
  return clean.length ? clean : null;
}

export function registerBlocks() {
  Blockly.common.defineBlocksWithJsonArray(definitions);
  Blockly.Blocks['rc_join'] = RC_JOIN;
  Blockly.Blocks['rc_send_channels'] = RC_SEND_CHANNELS;

  // Bloco "juntar" (text_join do Blockly) com nomes mais simples.
  Object.assign(Blockly.Msg, {
    TEXT_JOIN_TITLE_CREATEWITH: 'juntar',
    TEXT_CREATE_JOIN_TITLE_JOIN: 'juntar',
    TEXT_CREATE_JOIN_ITEM_TITLE_ITEM: 'pedaço',
    TEXT_JOIN_TOOLTIP: 'Junta textos e números numa linha só. Use a engrenagem ⚙️ para ter mais pedaços.',
  });

  // As variáveis guardam números: texto (como o do "juntar") não encaixa nelas.
  for (const [type, input] of [['variables_set', 'VALUE'], ['math_change', 'DELTA']]) {
    const block = Blockly.Blocks[type];
    const init = block.init;
    block.init = function () {
      init.call(this);
      this.getInput(input).setCheck(['Number', 'Boolean']);
    };
  }

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

  // "canal controla" fica solto (como um chapéu) e avisa se falta configurar
  // o motor/servo no "ao ligar".
  const link = Blockly.Blocks['rc_link_channel'];
  const linkInit = link.init;
  link.init = function () {
    linkInit.call(this);
    this.hat = 'cap';
  };
  link.onchange = function () {
    if (this.isInFlyout) return;
    const [servo] = this.getFieldValue('TARGET').split(':');
    const configured = this.workspace
      .getAllBlocks(false)
      .some((b) => b.isEnabled() && (servo === 'motor' ? b.type === 'rc_motor_setup' : b.type === 'rc_servo_setup' && b.getFieldValue('SERVO') === servo));
    const name = servo === 'motor' ? 'o motor' : `o servo ${servo === 'direcao' ? 'direção' : 'extra'}`;
    this.setWarningText(configured ? null : `Coloque "configurar ${servo === 'motor' ? 'motor' : 'servo'}" no "ao ligar" para ${name} funcionar.`);
  };

  // "valor recebido" só faz sentido dentro de um evento que recebe valor.
  Blockly.Blocks['rc_message_value'].onchange = function () {
    if (this.isInFlyout) return;
    this.setWarningText(
      receivingEvent(this) ? null : 'Use este bloco dentro de "quando receber o canal".',
    );
  };
}
