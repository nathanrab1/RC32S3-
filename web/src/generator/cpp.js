// Gerador de código Arduino C++ (ESP32) para os blocos do RC32S3.
//
// Só os blocos dentro dos "chapéus" (ao ligar, repetir sempre e eventos)
// geram código; blocos soltos são ignorados.
import * as Blockly from 'blockly';
import { receivingEvent } from '../blocks/rc_blocks.js';

export const Order = {
  ATOMIC: 0,
  UNARY_POSTFIX: 1,
  UNARY_PREFIX: 2,
  MULTIPLICATIVE: 3,
  ADDITIVE: 4,
  RELATIONAL: 6,
  EQUALITY: 7,
  LOGICAL_AND: 11,
  LOGICAL_OR: 12,
  CONDITIONAL: 13,
  ASSIGNMENT: 14,
  NONE: 99,
};

const HAT_TYPES = new Set([
  'rc_setup', 'rc_loop', 'rc_every', 'rc_on_message', 'rc_on_channel', 'rc_on_lost', 'rc_on_restored', 'rc_on_button',
  'rc_link_channel',
]);

const SERVO_VARS = { direcao: 'servoDirecao', extra: 'servoExtra' };

class CppGenerator extends Blockly.CodeGenerator {
  constructor() {
    super('Cpp');
    this.INDENT = '  ';
    this.addReservedWords(
      'setup,loop,int,float,double,bool,char,void,long,short,unsigned,signed,const,static,' +
      'if,else,for,while,do,switch,case,break,continue,return,true,false,new,delete,class,' +
      'struct,namespace,this,auto,register,volatile,goto,default,sizeof,typedef,union,enum,' +
      'Serial,RCLink,RCMotor,RCServo,motor,servoDirecao,servoExtra,valorRecebido,millis,' +
      'delay,random,constrain,map,min,max,abs,round,PI,HIGH,LOW,INPUT,OUTPUT',
    );
  }

  init(workspace) {
    super.init(workspace);
    this.definitions_ = Object.create(null);
    this.setupPrelude_ = [];
    this.loopPrelude_ = [];
    if (!this.nameDB_) this.nameDB_ = new Blockly.Names(this.RESERVED_WORDS_);
    else this.nameDB_.reset();
    this.nameDB_.setVariableMap(workspace.getVariableMap());
    this.nameDB_.populateVariables(workspace);
    this.nameDB_.populateProcedures(workspace);
  }

  scrub_(block, code, thisOnly) {
    const next = block.nextConnection && block.nextConnection.targetBlock();
    return code + (next && !thisOnly ? this.blockToCode(next) : '');
  }

  scrubNakedValue(line) {
    return line + ';\n';
  }

  quote_(text) {
    return '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
  }

  // Nome C++ seguro e sem acentos para funções geradas.
  funcName_(prefix, text) {
    const ascii = text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_]/g, '_');
    return this.nameDB_.getDistinctName(prefix + ascii, Blockly.Names.NameType.PROCEDURE);
  }

  // Gera o sketch completo (.ino) a partir de um workspace.
  sketch(workspace) {
    this.init(workspace);
    const setup = [];
    const loop = [];
    const functions = [];

    const hats = workspace.getTopBlocks(true).filter((b) => HAT_TYPES.has(b.type) && b.isEnabled());
    for (const block of hats) {
      const body = block.getInput('DO') ? this.statementToCode(block, 'DO') : '';
      switch (block.type) {
        case 'rc_setup':
          setup.push(body);
          break;
        case 'rc_loop':
          loop.push(body);
          break;
        case 'rc_every': {
          const ms = Number(block.getFieldValue('MS')) || 1;
          const fn = this.funcName_('a_cada_', `${ms}ms`);
          const timer = fn + '_t';
          functions.push(`void ${fn}() {\n${body}}`);
          this.definitions_['timer_' + fn] = `uint32_t ${timer} = 0;`;
          this.loopPrelude_.push(
            `if (millis() - ${timer} >= ${ms}) {\n    ${timer} = millis();\n    ${fn}();\n  }`,
          );
          break;
        }
        case 'rc_on_message': {
          const name = block.getFieldValue('NAME');
          const fn = this.funcName_('mensagem_', name);
          functions.push(`void ${fn}(float valorRecebido) {\n${body}}`);
          this.setupPrelude_.push(`RCLink.onMessage(${this.quote_(name)}, ${fn});`);
          break;
        }
        case 'rc_on_channel': {
          const ch = block.getFieldValue('CH');
          const fn = this.funcName_('canal_', ch);
          functions.push(`void ${fn}(float valorRecebido) {\n${body}}`);
          this.setupPrelude_.push(`RCLink.onChannel(${ch}, ${fn});`);
          break;
        }
        case 'rc_link_channel': {
          // Igual a "quando receber o canal" com um só bloco dentro.
          const ch = block.getFieldValue('CH');
          const [servo, mode] = block.getFieldValue('TARGET').split(':');
          const call = servo === 'motor' ? `${this.motor_()}.speed(valorRecebido)` : `${this.servo_(servo)}.${mode}(valorRecebido)`;
          const fn = this.funcName_(`canal_${ch}_`, servo);
          functions.push(`void ${fn}(float valorRecebido) {\n  ${call};\n}`);
          this.setupPrelude_.push(`RCLink.onChannel(${ch}, ${fn});`);
          break;
        }
        case 'rc_on_lost': {
          const fn = this.funcName_('sinal_perdido', '');
          functions.push(`void ${fn}() {\n${body}}`);
          this.setupPrelude_.push(`RCLink.onSignalLost(${fn});`);
          break;
        }
        case 'rc_on_restored': {
          const fn = this.funcName_('sinal_voltou', '');
          functions.push(`void ${fn}() {\n${body}}`);
          this.setupPrelude_.push(`RCLink.onSignalRestored(${fn});`);
          break;
        }
        case 'rc_on_button': {
          const pin = block.getFieldValue('PIN');
          const fn = this.funcName_('botao_pino_', pin);
          functions.push(`void ${fn}() {\n${body}}`);
          this.setupPrelude_.push(`RCLink.onButton(${pin}, ${fn});`);
          break;
        }
      }
    }

    const vars = Blockly.Variables.allUsedVarModels(workspace).map(
      (v) => `float ${this.nameDB_.getName(v.getId(), Blockly.Names.NameType.VARIABLE)} = 0;`,
    );

    const indent = (lines) => lines.map((l) => '  ' + l + '\n').join('');
    const parts = [
      '// Gerado pelo RC32S3',
      '#include <RCLink.h>',
      '',
    ];
    const defs = Object.values(this.definitions_);
    if (defs.length) parts.push(...defs, '');
    if (vars.length) parts.push(...vars, '');
    for (const f of functions) parts.push(f, '');
    parts.push(
      'void setup() {\n  rcSerialBegin(115200);\n' + indent(this.setupPrelude_) + setup.join('') + '}',
      '',
      'void loop() {\n  RCLink.update();\n' + indent(this.loopPrelude_) + loop.join('') + '}',
      '',
    );
    const code = parts.join('\n');
    this.finish('');
    return code;
  }

  // ---------------------------------------------------------------- ajudantes
  value_(block, name, order, fallback = '0') {
    return this.valueToCode(block, name, order) || fallback;
  }

  // Aceita o bloco (campo SERVO) ou o nome direto ('direcao' / 'extra').
  servo_(blockOrName) {
    const v = SERVO_VARS[typeof blockOrName === 'string' ? blockOrName : blockOrName.getFieldValue('SERVO')];
    this.definitions_['servo_' + v] = `RCServo ${v};`;
    return v;
  }

  motor_() {
    this.definitions_['motor'] = 'RCMotor motor;';
    return 'motor';
  }
}

export const cpp = new CppGenerator();
const g = cpp.forBlock;

// ------------------------------------------------------------------ Rádio
g['rc_radio_begin'] = (b) => `RCLink.begin(${Number(b.getFieldValue('NET')) || 0});\n`;
g['rc_send_channel'] = (b, gen) =>
  `RCLink.setChannel(${b.getFieldValue('CH')}, ${gen.value_(b, 'VALUE', Order.NONE)});\n`;
g['rc_send_channels'] = (b, gen) => {
  let code = '';
  for (let i = 0; b.getInput('ADD' + i); i++) {
    code += `RCLink.setChannel(${i + 1}, ${gen.value_(b, 'ADD' + i, Order.NONE)});\n`;
  }
  return code;
};
g['rc_send_message'] = (b, gen) =>
  `RCLink.sendMessage(${gen.quote_(b.getFieldValue('NAME'))}, ${gen.value_(b, 'VALUE', Order.NONE)});\n`;
g['rc_channel'] = (b) => [`RCLink.channel(${b.getFieldValue('CH')})`, Order.UNARY_POSTFIX];
g['rc_message_value'] = (b) => [receivingEvent(b) ? 'valorRecebido' : '0', Order.ATOMIC];
g['rc_connected'] = () => ['RCLink.connected()', Order.UNARY_POSTFIX];
g['rc_signal'] = () => ['RCLink.signalStrength()', Order.UNARY_POSTFIX];

// ------------------------------------------------------------------ Controle
g['rc_joystick'] = (b) => [`rcJoystick(${b.getFieldValue('PIN')}, ${b.getFieldValue('INV')})`, Order.UNARY_POSTFIX];
g['rc_pot'] = (b) => [`rcPot(${b.getFieldValue('PIN')})`, Order.UNARY_POSTFIX];
g['rc_button'] = (b) => [`rcButton(${b.getFieldValue('PIN')})`, Order.UNARY_POSTFIX];

// ------------------------------------------------------------------ Carrinho
g['rc_motor_setup'] = (b, gen) => `${gen.motor_()}.begin(${b.getFieldValue('PIN')}, ${b.getFieldValue('KIND')});\n`;
g['rc_motor_speed'] = (b, gen) => `${gen.motor_()}.speed(${gen.value_(b, 'VALUE', Order.NONE)});\n`;
g['rc_motor_stop'] = (b, gen) => `${gen.motor_()}.stop();\n`;
g['rc_servo_setup'] = (b, gen) =>
  `${gen.servo_(b)}.begin(${b.getFieldValue('PIN')}, ${b.getFieldValue('MIN')}, ${b.getFieldValue('MAX')});\n`;
g['rc_servo_position'] = (b, gen) => `${gen.servo_(b)}.position(${gen.value_(b, 'VALUE', Order.NONE)});\n`;
g['rc_servo_angle'] = (b, gen) => `${gen.servo_(b)}.angle(${gen.value_(b, 'VALUE', Order.NONE, '90')});\n`;

// ------------------------------------------------------------------ LEDs
g['rc_led'] = (b) => `rcLed(${b.getFieldValue('PIN')}, ${b.getFieldValue('STATE')});\n`;
g['rc_led_toggle'] = (b) => `rcLedToggle(${b.getFieldValue('PIN')});\n`;
g['rc_board_led'] = (b) => `rcBoardLed(${b.getFieldValue('COLOR')});\n`;
g['rc_board_led_rgb'] = (b, gen) => {
  const c = (n) => `constrain((int)(${gen.value_(b, n, Order.NONE)}), 0, 255)`;
  return `rcBoardLed(${c('R')}, ${c('G')}, ${c('B')});\n`;
};

// ------------------------------------------------------------------ Tempo
g['rc_wait'] = (b, gen) => `rcWait(${gen.value_(b, 'MS', Order.NONE)});\n`;
g['rc_millis'] = () => ['millis()', Order.UNARY_POSTFIX];

// ------------------------------------------------------------------ Matemática
g['rc_map'] = (b, gen) => {
  const v = (n) => gen.value_(b, n, Order.NONE);
  return [`rcMap(${v('X')}, ${v('IN_MIN')}, ${v('IN_MAX')}, ${v('OUT_MIN')}, ${v('OUT_MAX')})`, Order.UNARY_POSTFIX];
};

// ------------------------------------------------------------------ Monitor
// rcStr(): números inteiros sem ".00", verdadeiro/falso em português.
g['rc_print'] = (b, gen) => `Serial.println(rcStr(${gen.value_(b, 'VALUE', Order.NONE, '""')}));\n`;

// "juntar" (rc_join, em uma linha) e o text_join do Blockly (projetos antigos).
g['rc_join'] = (b, gen) => g['text_join'](b, gen);
g['text_join'] = (b, gen) => {
  const parts = [];
  for (let i = 0; b.getInput('ADD' + i); i++) {
    const v = gen.valueToCode(b, 'ADD' + i, Order.NONE);
    if (v) parts.push(`rcStr(${v})`);
  }
  if (!parts.length) return ['String("")', Order.UNARY_POSTFIX];
  return [parts.join(' + '), parts.length > 1 ? Order.ADDITIVE : Order.UNARY_POSTFIX];
};

// ------------------------------------------------------------------ Blocos padrão do Blockly
g['text'] = (b, gen) => [gen.quote_(b.getFieldValue('TEXT')), Order.ATOMIC];

g['math_number'] = (b) => {
  const n = Number(b.getFieldValue('NUM'));
  return [String(n), n < 0 ? Order.UNARY_PREFIX : Order.ATOMIC];
};

g['math_arithmetic'] = (b, gen) => {
  const ops = {
    ADD: [' + ', Order.ADDITIVE],
    MINUS: [' - ', Order.ADDITIVE],
    MULTIPLY: [' * ', Order.MULTIPLICATIVE],
    DIVIDE: [' / ', Order.MULTIPLICATIVE],
  };
  const op = b.getFieldValue('OP');
  if (op === 'POWER') {
    return [`powf(${gen.value_(b, 'A', Order.NONE)}, ${gen.value_(b, 'B', Order.NONE)})`, Order.UNARY_POSTFIX];
  }
  const [sym, order] = ops[op];
  let a = gen.value_(b, 'A', order);
  const c = gen.value_(b, 'B', order);
  if (op === 'DIVIDE') a = `(float)${gen.value_(b, 'A', Order.UNARY_PREFIX)}`; // evita divisão inteira
  return [a + sym + c, order];
};

g['math_single'] = (b, gen) => {
  const op = b.getFieldValue('OP');
  if (op === 'NEG') return ['-' + gen.value_(b, 'NUM', Order.UNARY_PREFIX), Order.UNARY_PREFIX];
  const fns = { ROOT: 'sqrtf', ABS: 'fabsf', LN: 'logf', LOG10: 'log10f', EXP: 'expf' };
  const x = gen.value_(b, 'NUM', Order.NONE);
  if (op === 'POW10') return [`powf(10, ${x})`, Order.UNARY_POSTFIX];
  return [`${fns[op]}(${x})`, Order.UNARY_POSTFIX];
};

g['math_round'] = (b, gen) => {
  const fns = { ROUND: 'roundf', ROUNDUP: 'ceilf', ROUNDDOWN: 'floorf' };
  return [`${fns[b.getFieldValue('OP')]}(${gen.value_(b, 'NUM', Order.NONE)})`, Order.UNARY_POSTFIX];
};

g['math_modulo'] = (b, gen) =>
  [`fmodf(${gen.value_(b, 'DIVIDEND', Order.NONE)}, ${gen.value_(b, 'DIVISOR', Order.NONE, '1')})`, Order.UNARY_POSTFIX];

g['math_constrain'] = (b, gen) => [
  `constrain((float)(${gen.value_(b, 'VALUE', Order.NONE)}), (float)(${gen.value_(b, 'LOW', Order.NONE)}), (float)(${gen.value_(b, 'HIGH', Order.NONE, '100')}))`,
  Order.UNARY_POSTFIX,
];

g['math_random_int'] = (b, gen) => [
  `random((long)(${gen.value_(b, 'FROM', Order.NONE)}), (long)(${gen.value_(b, 'TO', Order.NONE, '100')}) + 1)`,
  Order.UNARY_POSTFIX,
];

g['logic_boolean'] = (b) => [b.getFieldValue('BOOL') === 'TRUE' ? 'true' : 'false', Order.ATOMIC];

g['logic_compare'] = (b, gen) => {
  const ops = { EQ: '==', NEQ: '!=', LT: '<', LTE: '<=', GT: '>', GTE: '>=' };
  const op = b.getFieldValue('OP');
  const order = op === 'EQ' || op === 'NEQ' ? Order.EQUALITY : Order.RELATIONAL;
  return [`${gen.value_(b, 'A', order)} ${ops[op]} ${gen.value_(b, 'B', order)}`, order];
};

g['logic_operation'] = (b, gen) => {
  const and = b.getFieldValue('OP') === 'AND';
  const order = and ? Order.LOGICAL_AND : Order.LOGICAL_OR;
  const fallback = and ? 'true' : 'false';
  return [`${gen.value_(b, 'A', order, fallback)} ${and ? '&&' : '||'} ${gen.value_(b, 'B', order, fallback)}`, order];
};

g['logic_negate'] = (b, gen) => ['!' + gen.value_(b, 'BOOL', Order.UNARY_PREFIX, 'true'), Order.UNARY_PREFIX];

g['logic_ternary'] = (b, gen) => [
  `${gen.value_(b, 'IF', Order.CONDITIONAL, 'false')} ? ${gen.value_(b, 'THEN', Order.CONDITIONAL)} : ${gen.value_(b, 'ELSE', Order.CONDITIONAL)}`,
  Order.CONDITIONAL,
];

g['controls_if'] = (b, gen) => {
  let n = 0;
  let code = '';
  do {
    const cond = gen.value_(b, 'IF' + n, Order.NONE, 'false');
    code += `${n > 0 ? ' else ' : ''}if (${cond}) {\n${gen.statementToCode(b, 'DO' + n)}}`;
    n++;
  } while (b.getInput('IF' + n));
  if (b.getInput('ELSE')) code += ` else {\n${gen.statementToCode(b, 'ELSE')}}`;
  return code + '\n';
};

g['controls_repeat_ext'] = (b, gen) => {
  const times = gen.value_(b, 'TIMES', Order.ASSIGNMENT);
  const i = gen.nameDB_.getDistinctName('i', Blockly.Names.NameType.VARIABLE);
  return `for (int ${i} = 0; ${i} < ${times}; ${i}++) {\n${gen.statementToCode(b, 'DO')}}\n`;
};

g['controls_whileUntil'] = (b, gen) => {
  let cond = gen.value_(b, 'BOOL', Order.NONE, 'false');
  if (b.getFieldValue('MODE') === 'UNTIL') cond = `!(${cond})`;
  // RCLink.update() dentro do laço mantém o rádio e o failsafe funcionando.
  return `while (${cond}) {\n  RCLink.update();\n${gen.statementToCode(b, 'DO')}}\n`;
};

g['controls_for'] = (b, gen) => {
  const v = gen.getVariableName(b.getFieldValue('VAR'));
  const from = gen.value_(b, 'FROM', Order.NONE);
  const to = gen.value_(b, 'TO', Order.NONE);
  const by = gen.value_(b, 'BY', Order.NONE, '1');
  const s = gen.nameDB_.getDistinctName(v + '_passo', Blockly.Names.NameType.VARIABLE);
  const end = gen.nameDB_.getDistinctName(v + '_fim', Blockly.Names.NameType.VARIABLE);
  return (
    `{\n  float ${end} = ${to};\n  float ${s} = fabsf(${by});\n` +
    `  if (${s} == 0) ${s} = 1;\n  if (${from} > ${end}) ${s} = -${s};\n` +
    `  for (${v} = ${from}; ${s} > 0 ? ${v} <= ${end} : ${v} >= ${end}; ${v} += ${s}) {\n` +
    gen.prefixLines(gen.statementToCode(b, 'DO'), '  ') +
    '  }\n}\n'
  );
};

g['controls_flow_statements'] = (b) => (b.getFieldValue('FLOW') === 'BREAK' ? 'break;\n' : 'continue;\n');

g['variables_get'] = (b, gen) => [gen.getVariableName(b.getFieldValue('VAR')), Order.ATOMIC];
g['variables_set'] = (b, gen) =>
  `${gen.getVariableName(b.getFieldValue('VAR'))} = ${gen.value_(b, 'VALUE', Order.ASSIGNMENT)};\n`;
g['math_change'] = (b, gen) =>
  `${gen.getVariableName(b.getFieldValue('VAR'))} += ${gen.value_(b, 'DELTA', Order.ASSIGNMENT)};\n`;
