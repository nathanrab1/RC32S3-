// Toolboxes do Controle (TX) e do Carrinho (RX), e os programas iniciais.
import { COLORS } from './blocks/rc_blocks.js';

const num = (n) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
const block = (type, inputs, fields) => ({ kind: 'block', type, ...(inputs && { inputs }), ...(fields && { fields }) });

const programa = {
  kind: 'category',
  name: 'Programa',
  colour: COLORS.programa,
  contents: [block('rc_setup'), block('rc_loop'), block('rc_every')],
};

const radioComum = [
  block('rc_radio_begin'),
  block('rc_send_message', { VALUE: num(1) }),
  block('rc_on_message'),
  block('rc_message_value'),
  block('rc_connected'),
  block('rc_signal'),
  block('rc_on_lost'),
  block('rc_on_restored'),
];

const radioTx = {
  kind: 'category',
  name: 'Rádio',
  colour: COLORS.radio,
  contents: [
    radioComum[0],
    block('rc_send_channel', { VALUE: num(0) }),
    ...radioComum.slice(1),
  ],
};

const radioRx = {
  kind: 'category',
  name: 'Rádio',
  colour: COLORS.radio,
  contents: [radioComum[0], block('rc_channel'), ...radioComum.slice(1)],
};

const controle = {
  kind: 'category',
  name: 'Joystick e botões',
  colour: COLORS.controle,
  contents: [block('rc_joystick'), block('rc_pot'), block('rc_button'), block('rc_on_button')],
};

const carrinho = {
  kind: 'category',
  name: 'Motor e servos',
  colour: COLORS.carrinho,
  contents: [
    block('rc_motor_setup'),
    block('rc_motor_speed', { VALUE: num(50) }),
    block('rc_motor_stop'),
    block('rc_servo_setup'),
    block('rc_servo_position', { VALUE: num(0) }),
    block('rc_servo_angle', { VALUE: num(90) }),
  ],
};

const leds = {
  kind: 'category',
  name: 'LEDs',
  colour: COLORS.leds,
  contents: [
    block('rc_board_led'),
    block('rc_board_led_rgb', { R: num(255), G: num(0), B: num(0) }),
    block('rc_led'),
    block('rc_led_toggle'),
  ],
};

const tempo = {
  kind: 'category',
  name: 'Tempo',
  colour: COLORS.tempo,
  contents: [block('rc_wait', { MS: num(1000) }), block('rc_millis')],
};

const logica = {
  kind: 'category',
  name: 'Lógica',
  categorystyle: 'logic_category',
  contents: [
    block('controls_if'),
    { kind: 'block', type: 'controls_if', extraState: { hasElse: true } },
    block('logic_compare'),
    block('logic_operation'),
    block('logic_negate'),
    block('logic_boolean'),
    block('logic_ternary'),
  ],
};

const lacos = {
  kind: 'category',
  name: 'Repetições',
  categorystyle: 'loop_category',
  contents: [
    block('controls_repeat_ext', { TIMES: num(10) }),
    block('controls_whileUntil'),
    block('controls_for', { FROM: num(1), TO: num(10), BY: num(1) }),
    block('controls_flow_statements'),
  ],
};

const matematica = {
  kind: 'category',
  name: 'Matemática',
  categorystyle: 'math_category',
  contents: [
    block('math_number'),
    block('math_arithmetic', { A: num(1), B: num(1) }),
    block('math_single', { NUM: num(9) }),
    block('math_round', { NUM: num(3.1) }),
    block('math_modulo', { DIVIDEND: num(64), DIVISOR: num(10) }),
    block('math_constrain', { VALUE: num(50), LOW: num(-100), HIGH: num(100) }),
    block('rc_map', { X: num(50), IN_MIN: num(0), IN_MAX: num(100), OUT_MIN: num(-100), OUT_MAX: num(100) }),
    block('math_random_int', { FROM: num(1), TO: num(100) }),
  ],
};

const variaveis = { kind: 'category', name: 'Variáveis', categorystyle: 'variable_category', custom: 'VARIABLE' };

const monitor = {
  kind: 'category',
  name: 'Monitor',
  colour: COLORS.monitor,
  contents: [
    // Texto só existe aqui (as variáveis guardam apenas números).
    block('rc_print', { VALUE: { shadow: { type: 'text', fields: { TEXT: 'olá!' } } } }),
    block('rc_print', { VALUE: { shadow: { type: 'math_number', fields: { NUM: 0 } } } }),
  ],
};

const sep = { kind: 'sep' };

export const toolboxTx = {
  kind: 'categoryToolbox',
  contents: [programa, radioTx, controle, leds, tempo, sep, logica, lacos, matematica, variaveis, monitor],
};

export const toolboxRx = {
  kind: 'categoryToolbox',
  contents: [programa, radioRx, carrinho, leds, tempo, sep, logica, lacos, matematica, variaveis, monitor],
};

// ------------------------------------------------------------------ Programas iniciais

const chain = (...blocks) =>
  blocks.reduceRight((next, b) => (next ? { ...b, next: { block: next } } : b), null);

const shadowNum = (n) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });

export const defaultTx = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'rc_setup', x: 30, y: 30,
        inputs: { DO: { block: chain(
          { type: 'rc_radio_begin', fields: { NET: 1 } },
          { type: 'rc_board_led', fields: { COLOR: '0,0,255' } },
        ) } },
      },
      {
        type: 'rc_loop', x: 30, y: 230,
        inputs: { DO: { block: chain(
          { type: 'rc_send_channel', fields: { CH: '1' }, inputs: {
            VALUE: { ...shadowNum(0), block: { type: 'rc_joystick', fields: { PIN: '1', INV: 'false' } } },
          } },
          { type: 'rc_send_channel', fields: { CH: '2' }, inputs: {
            VALUE: { ...shadowNum(0), block: { type: 'rc_joystick', fields: { PIN: '2', INV: 'false' } } },
          } },
        ) } },
      },
      {
        type: 'rc_on_button', x: 30, y: 460, fields: { PIN: '4' },
        inputs: { DO: { block: { type: 'rc_send_message', fields: { NAME: 'farol' }, inputs: { VALUE: shadowNum(1) } } } },
      },
    ],
  },
};

export const defaultRx = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'rc_setup', x: 30, y: 30,
        inputs: { DO: { block: chain(
          { type: 'rc_radio_begin', fields: { NET: 1 } },
          { type: 'rc_motor_setup', fields: { PIN: '5', KIND: 'true' } },
          { type: 'rc_servo_setup', fields: { SERVO: 'direcao', PIN: '6', MIN: 45, MAX: 135 } },
          { type: 'rc_board_led', fields: { COLOR: '255,0,0' } },
        ) } },
      },
      {
        type: 'rc_loop', x: 30, y: 330,
        inputs: { DO: { block: chain(
          { type: 'rc_motor_speed', inputs: {
            VALUE: { ...shadowNum(0), block: { type: 'rc_channel', fields: { CH: '1' } } },
          } },
          { type: 'rc_servo_position', fields: { SERVO: 'direcao' }, inputs: {
            VALUE: { ...shadowNum(0), block: { type: 'rc_channel', fields: { CH: '2' } } },
          } },
        ) } },
      },
      {
        type: 'rc_on_message', x: 760, y: 30, fields: { NAME: 'farol' },
        inputs: { DO: { block: { type: 'rc_led_toggle', fields: { PIN: '8' } } } },
      },
      {
        type: 'rc_on_lost', x: 760, y: 200,
        inputs: { DO: { block: { type: 'rc_board_led', fields: { COLOR: '255,0,0' } } } },
      },
      {
        type: 'rc_on_restored', x: 760, y: 370,
        inputs: { DO: { block: { type: 'rc_board_led', fields: { COLOR: '0,255,0' } } } },
      },
    ],
  },
};
