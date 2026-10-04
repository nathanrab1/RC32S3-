// Teste de navegador da paleta central (arrastar blocos para o Controle e o
// Carrinho). Precisa do Chrome instalado e do app rodando.
// Uso: npm run test:e2e   (variáveis: CHROME, URL, SCREENSHOTS)
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL || 'http://localhost:3232/';
const OUT = process.env.SCREENSHOTS || null;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  defaultViewport: { width: 1500, height: 900 },
});
const page = await browser.newPage();
// Os testes usam sempre o mesmo projeto (não o projeto padrão do app, que
// pode mudar): ele é colocado como "último projeto aberto" a cada carga.
const FIXTURE = readFileSync(new globalThis.URL('./fixtures/e2e-project.rc32s3.json', import.meta.url), 'utf8');
await page.evaluateOnNewDocument((p) => localStorage.setItem('rc.project', p), FIXTURE);
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
await page.goto(URL, { waitUntil: 'networkidle2' });
if (OUT) await page.screenshot({ path: `${OUT}/e2e-0-inicio.png` });

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? '✔' : '✖'} ${name}${extra ? ' — ' + extra : ''}`);

async function clickCategory(name) {
  await page.evaluate((n) => [...document.querySelectorAll('.cat-btn')].find((b) => b.textContent.includes(n)).click(), name);
  await new Promise((r) => setTimeout(r, 150));
}
async function paletteBlockRect(type) {
  return page.evaluate((t) => {
    const b = window.rc.palette.workspace.getTopBlocks(true).find((x) => x.type === t);
    const r = b.getSvgRoot().getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, type);
}
async function count(role, type) {
  return page.evaluate((r, t) => window.rc.workspaces[r].getAllBlocks(false).filter((b) => b.type === t).length, role, type);
}
async function dragPath(from, points) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (const p of points) await page.mouse.move(p.x, p.y, { steps: 12 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 300));
}
async function wsRect(role) {
  return page.evaluate((r) => {
    const x = document.getElementById('ws-' + r).getBoundingClientRect();
    return { x: x.left, y: x.top, w: x.width, h: x.height };
  }, role);
}

// A: arrastar "LED da placa" para uma área livre do Carrinho.
await clickCategory('LEDs');
let src = await paletteBlockRect('rc_board_led');
let rx = await wsRect('rx');
let before = await count('rx', 'rc_board_led');
await dragPath({ x: src.x + 10, y: src.y + 10 }, [{ x: rx.x + rx.w * 0.5, y: rx.y + rx.h * 0.8 }]);
check('A: bloco solto no Carrinho', (await count('rx', 'rc_board_led')) === before + 1);
const flags = await page.evaluate(() => window.rc.workspaces.rx.getAllBlocks(false).filter((b) => b.type === 'rc_board_led').map((b) => b.isMovable() && b.isDeletable() && b.isEditable()));
check('A2: bloco arrastado pode ser movido, apagado e editado', flags.every(Boolean), JSON.stringify(flags));

// B: encaixar "esperar" logo abaixo de "ligar rádio na rede" no Controle.
await clickCategory('Tempo');
src = await paletteBlockRect('rc_wait');
const radio = await page.evaluate(() => {
  const b = window.rc.workspaces.tx.getAllBlocks(false).find((x) => x.type === 'rc_radio_begin');
  const r = b.getSvgRoot().getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
await dragPath({ x: src.x + 8, y: src.y + 8 }, [{ x: radio.x + 8, y: radio.y + radio.h + 8 }]);
const next = await page.evaluate(() => window.rc.workspaces.tx.getAllBlocks(false).find((x) => x.type === 'rc_radio_begin').getNextBlock()?.type);
check('B: encaixou abaixo de "ligar rádio" no Controle', next === 'rc_wait', `próximo bloco = ${next}`);

// C: bloco só do Carrinho (motor) no Controle deve ser recusado.
await clickCategory('Motor');
src = await paletteBlockRect('rc_motor_speed');
let tx = await wsRect('tx');
await page.mouse.move(src.x + 10, src.y + 10);
await page.mouse.down();
await page.mouse.move(tx.x + tx.w * 0.6, tx.y + tx.h * 0.7, { steps: 12 });
const label = await page.evaluate(() => document.querySelector('.palette-ghost-label')?.textContent);
if (OUT) await page.screenshot({ path: `${OUT}/e2e-1-recusado.png` });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 200));
const toast = await page.evaluate(() => !document.getElementById('toast').hidden && document.getElementById('toast').textContent);
check('C: motor recusado no Controle', (await count('tx', 'rc_motor_speed')) === 0, `aviso: "${label}" / toast: "${toast}"`);

// D: entrar no Controle e voltar para a paleta sem soltar: nada é criado.
await clickCategory('LEDs');
src = await paletteBlockRect('rc_led');
before = await count('tx', 'rc_led');
await dragPath({ x: src.x + 10, y: src.y + 10 }, [{ x: tx.x + tx.w * 0.5, y: tx.y + tx.h * 0.6 }, { x: src.x + 40, y: src.y + 40 }]);
check('D: entrou e saiu sem soltar não cria bloco', (await count('tx', 'rc_led')) === before);

// E: arrastar para a lixeira não cria bloco.
const trash = await page.evaluate(() => {
  const r = window.rc.workspaces.rx.trashcan.svgGroup.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
before = await count('rx', 'rc_led');
await dragPath({ x: src.x + 10, y: src.y + 10 }, [{ x: rx.x + rx.w * 0.3, y: rx.y + rx.h * 0.5 }, trash]);
check('E: soltar na lixeira não cria bloco', (await count('rx', 'rc_led')) === before);

// F: variáveis: criar e arrastar "alterar" para o Carrinho cria a variável lá.
await clickCategory('Variáveis');
page.once('dialog', (d) => d.accept('velocidade'));
await page.evaluate(() => document.querySelector('#palette-tools .btn').click());
await new Promise((r) => setTimeout(r, 200));
src = await page.evaluate(() => {
  const b = window.rc.palette.workspace.getTopBlocks(true).find((x) => x.type === 'variables_get' && x.getField('VAR').getText() === 'velocidade');
  const r = b.getSvgRoot().getBoundingClientRect();
  return { x: r.left, y: r.top };
});
await dragPath({ x: src.x + 10, y: src.y + 10 }, [{ x: rx.x + rx.w * 0.6, y: rx.y + rx.h * 0.3 }]);
const vars = await page.evaluate(() => window.rc.workspaces.rx.getVariableMap().getAllVariables().map((v) => v.getName()));
check('F: variável criada no Carrinho ao soltar', vars.includes('velocidade'), `variáveis do Carrinho: ${vars.join(', ')}`);

// G: desfazer (Ctrl+Z) no Controle remove o "esperar" encaixado em B.
await page.evaluate(() => { window.rc.workspaces.tx.undo(false); });
await new Promise((r) => setTimeout(r, 200));
check('G: desfazer remove o último bloco arrastado no Controle', (await count('tx', 'rc_wait')) === 2, `esperar no Controle: ${await count('tx', 'rc_wait')}`);

// H: encaixar "esperar" dentro do "repetir sempre" (vazio) do Carrinho.
await clickCategory('Tempo');
src = await paletteBlockRect('rc_wait');
const loopRx = await page.evaluate(() => {
  const b = window.rc.workspaces.rx.getAllBlocks(false).find((x) => x.type === 'rc_loop');
  const r = b.getSvgRoot().getBoundingClientRect();
  return { x: r.left, y: r.top };
});
// O encaixe do "repetir sempre" fica ~16 px para dentro e logo abaixo do título.
await dragPath({ x: src.x + 8, y: src.y + 8 }, [{ x: loopRx.x + 30, y: loopRx.y + 52 }]);
const inside = await page.evaluate(() => window.rc.workspaces.rx.getAllBlocks(false).find((x) => x.type === 'rc_loop').getInputTargetBlock('DO')?.type);
check('H: encaixou dentro de "repetir sempre" no Carrinho', inside === 'rc_wait', `dentro = ${inside}`);

// I: o valor escolhido na paleta vai junto com o bloco.
await clickCategory('LEDs');
await page.evaluate(() => window.rc.palette.workspace.getTopBlocks(true).find((x) => x.type === 'rc_board_led').setFieldValue('0,0,255', 'COLOR'));
src = await paletteBlockRect('rc_board_led');
await dragPath({ x: src.x + 10, y: src.y + 10 }, [{ x: rx.x + rx.w * 0.4, y: rx.y + rx.h * 0.9 }]);
const colors = await page.evaluate(() => window.rc.workspaces.rx.getAllBlocks(false).filter((b) => b.type === 'rc_board_led').map((b) => b.getFieldValue('COLOR')));
check('I: valor escolhido na paleta (azul) mantido', colors.includes('0,0,255'), colors.join(' | '));

// J: clicar (sem arrastar) num menu de um bloco da paleta abre o menu.
await clickCategory('LEDs');
const dd = await page.evaluate(() => {
  const b = window.rc.palette.workspace.getTopBlocks(true).find((x) => x.type === 'rc_board_led');
  const r = b.getField('COLOR').getSvgRoot().getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.click(dd.x, dd.y);
await new Promise((r) => setTimeout(r, 300));
const menuOpen = await page.evaluate(() => !!document.querySelector('.blocklyDropDownDiv .blocklyMenu, .blocklyDropDownDiv [role="listbox"]') && getComputedStyle(document.querySelector('.blocklyDropDownDiv')).display !== 'none');
check('J: menu de opções abre ao clicar na paleta', menuOpen);
await page.keyboard.press('Escape');

// K: arrastar um bloco do Carrinho para a paleta apaga o bloco.
const blockRect = (role, type) => page.evaluate((r, t) => {
  const b = window.rc.workspaces[r].getTopBlocks(false).find((x) => x.type === t);
  const rr = b.getSvgRoot().getBoundingClientRect();
  return { x: rr.left, y: rr.top, xy: b.getRelativeToSurfaceXY() };
}, role, type);
const pal = await page.evaluate(() => { const r = document.querySelector('.palette').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
let loop = await blockRect('rx', 'rc_loop');
before = await count('rx', 'rc_loop');
await page.mouse.move(loop.x + 30, loop.y + 25);
await page.mouse.down();
await page.mouse.move(pal.x, pal.y, { steps: 15 });
const overlay = await page.evaluate(() => document.querySelector('.palette').classList.contains('drop-delete'));
const ghostVisible = await page.evaluate(() => !!document.querySelector('.palette-ghost.deleting'));
if (OUT) await page.screenshot({ path: `${OUT}/e2e-3-apagar.png` });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 300));
check('K: soltar na paleta apaga o bloco do Carrinho', (await count('rx', 'rc_loop')) === before - 1, `aviso "Solte para apagar" visível: ${overlay}`);
check('K2: bloco aparece por cima da paleta enquanto arrasta', ghostVisible);

// L: desfazer traz o bloco apagado de volta.
await page.evaluate(() => window.rc.workspaces.rx.undo(false));
await new Promise((r) => setTimeout(r, 300));
check('L: desfazer recupera o bloco apagado', (await count('rx', 'rc_loop')) === before);

// M: soltar um bloco do Carrinho em cima do Controle: volta para o lugar.
loop = await blockRect('rx', 'rc_loop');
const txBefore = await page.evaluate(() => window.rc.workspaces.tx.getAllBlocks(false).length);
await page.mouse.move(loop.x + 30, loop.y + 25);
await page.mouse.down();
await page.mouse.move(tx.x + tx.w * 0.5, tx.y + tx.h * 0.5, { steps: 20 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 400));
const after = await blockRect('rx', 'rc_loop');
const txAfter = await page.evaluate(() => window.rc.workspaces.tx.getAllBlocks(false).length);
check('M: soltar no outro lado devolve o bloco', Math.abs(after.xy.x - loop.xy.x) < 1 && Math.abs(after.xy.y - loop.xy.y) < 1 && txAfter === txBefore,
  `posição antes ${Math.round(loop.xy.x)},${Math.round(loop.xy.y)} depois ${Math.round(after.xy.x)},${Math.round(after.xy.y)}`);

// N: o mesmo vale para blocos do Controle soltos na paleta.
const txLoop = await blockRect('tx', 'rc_loop');
before = await count('tx', 'rc_loop');
await page.mouse.move(txLoop.x + 30, txLoop.y + 25);
await page.mouse.down();
await page.mouse.move(pal.x, pal.y, { steps: 15 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 300));
check('N: soltar na paleta apaga o bloco do Controle', (await count('tx', 'rc_loop')) === before - 1);
check('O: nenhuma sombra sobrando depois de soltar', await page.evaluate(() => document.querySelectorAll('.palette-ghost').length === 0));

// P: alça do painel "Mensagens" muda a altura, é lembrada e volta ao padrão.
await page.click('#log-toggle');
await new Promise((r) => setTimeout(r, 200));
const logH = () => page.evaluate(() => Math.round(document.getElementById('log-body').getBoundingClientRect().height));
const wsH = () => page.evaluate(() => Math.round(document.getElementById('ws-tx').getBoundingClientRect().height));
const h0 = await logH();
const w0 = await wsH();
const hd = await page.evaluate(() => { const r = document.querySelector('[data-resize="log-body"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await dragPath({ x: hd.x, y: hd.y }, [{ x: hd.x, y: hd.y - 150 }]);
const h1 = await logH();
const w1 = await wsH();
check('P: arrastar a alça aumenta "Mensagens" e diminui os blocos', h1 - h0 > 140 && w0 - w1 > 140, `mensagens ${h0}→${h1}px, área de blocos ${w0}→${w1}px`);
await page.reload({ waitUntil: 'networkidle2' });
await page.click('#log-toggle');
await new Promise((r) => setTimeout(r, 200));
const h2 = await logH();
check('P2: altura lembrada depois de recarregar', Math.abs(h2 - h1) <= 1, `${h2}px`);
const hd2 = await page.evaluate(() => { const r = document.querySelector('[data-resize="log-body"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
// Duplo clique (no Puppeteer 25 a opção é "count"; "clickCount" manda um clique só).
const doubleClick = (x, y) => page.mouse.click(x, y, { count: 2 });
await doubleClick(hd2.x, hd2.y);
await new Promise((r) => setTimeout(r, 200));
check('P3: dois cliques voltam ao tamanho padrão', Math.abs((await logH()) - h0) <= 1, `${await logH()}px`);

// Q: o Monitor Serial também tem alça.
await page.click('#btn-monitor');
await new Promise((r) => setTimeout(r, 300));
const monH = () => page.evaluate(() => Math.round(document.getElementById('monitor').getBoundingClientRect().height));
const m0 = await monH();
const md = await page.evaluate(() => { const r = document.querySelector('[data-resize="monitor"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await dragPath({ x: md.x, y: md.y }, [{ x: md.x, y: md.y - 100 }]);
check('Q: alça do Monitor muda a altura', (await monH()) - m0 > 90, `${m0}→${await monH()}px`);
await doubleClick(md.x, md.y - 100);
check('Q2: dois cliques voltam o Monitor ao padrão', Math.abs((await monH()) - m0) <= 1, `${await monH()}px`);
await page.click('#btn-monitor');

// S: "mostrar no monitor (juntar …)" da categoria Monitor vai para o Controle
// e gera a linha juntando os pedaços.
await clickCategory('Monitor');
const joinSrc = await page.evaluate(() => {
  const b = window.rc.palette.workspace.getTopBlocks(true).find((x) => x.type === 'rc_print' && x.getInputTargetBlock('VALUE')?.type === 'rc_join');
  const r = b.getSvgRoot().getBoundingClientRect();
  return { x: r.left + 10, y: r.top + 10, label: b.getInputTargetBlock('VALUE').toString() };
});
// (o "repetir sempre" do Controle foi apagado no teste N; usa o "ao ligar")
const txLoop2 = await page.evaluate(() => {
  const b = window.rc.workspaces.tx.getTopBlocks(false).find((x) => x.type === 'rc_setup');
  const r = b.getSvgRoot().getBoundingClientRect();
  return { x: r.left, y: r.top };
});
await dragPath({ x: joinSrc.x, y: joinSrc.y }, [{ x: txLoop2.x + 30, y: txLoop2.y + 52 }]);
const joinCode = await page.evaluate(() => window.rc.cpp.sketch(window.rc.workspaces.tx));
check('S: bloco "juntar" no Controle gera a linha juntada', joinCode.includes('Serial.println(rcStr(rcStr("valor: ") + rcStr(0)));'), `texto do bloco: ${joinSrc.label}`);

// T: "juntar" em uma linha, com ➕/➖ no fim; desfazer/refazer funcionam.
const joinInfo = () => page.evaluate(() => {
  const j = window.rc.workspaces.tx.getAllBlocks(false).find((x) => x.type === 'rc_join');
  const fields = j.getInput('BUTTONS').fieldRow;
  const rects = fields.map((f) => { const r = f.getSvgRoot().getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const ys = [...Array(j.itemCount).keys()].map((i) => Math.round(j.getInputTargetBlock('ADD' + i).getSvgRoot().getBoundingClientRect().top));
  return { count: j.itemCount, plus: rects.at(-1), minus: fields.length > 1 ? rects[0] : null, mesmaLinha: Math.max(...ys) - Math.min(...ys) < 4 };
});
let ji = await joinInfo();
check('T: pedaços do "juntar" na mesma linha', ji.mesmaLinha, `${ji.count} pedaços`);
await page.mouse.click(ji.plus.x, ji.plus.y);
await new Promise((r) => setTimeout(r, 200));
const afterPlus = await joinInfo();
check('T2: ➕ acrescenta um pedaço à direita', afterPlus.count === ji.count + 1 && afterPlus.mesmaLinha, `${ji.count} → ${afterPlus.count}`);
await page.evaluate(() => window.rc.workspaces.tx.undo(false));
await new Promise((r) => setTimeout(r, 200));
const afterUndo = (await joinInfo()).count;
await page.evaluate(() => window.rc.workspaces.tx.undo(true));
await new Promise((r) => setTimeout(r, 200));
const afterRedo = (await joinInfo()).count;
check('T3: desfazer e refazer o ➕', afterUndo === ji.count && afterRedo === ji.count + 1, `desfazer → ${afterUndo}, refazer → ${afterRedo}`);
ji = await joinInfo();
await page.mouse.click(ji.minus.x, ji.minus.y);
await new Promise((r) => setTimeout(r, 200));
check('T4: ➖ tira o último pedaço', (await joinInfo()).count === ji.count - 1);
const orphans = await page.evaluate(() => window.rc.workspaces.tx.getTopBlocks(false).filter((b) => b.isShadow()).length);
check('T5: nenhum pedaço solto sobrando na área', orphans === 0, `${orphans} soltos`);
if (OUT) {
  const jr = await page.evaluate(() => { const r = window.rc.workspaces.tx.getAllBlocks(false).find((x) => x.type === 'rc_print' && x.getInputTargetBlock('VALUE')?.type === 'rc_join').getSvgRoot().getBoundingClientRect(); return { x: r.left - 5, y: r.top - 5, width: r.width + 10, height: r.height + 10 }; });
  await page.screenshot({ path: `${OUT}/e2e-juntar.png`, clip: jr });
}

// U: alças verticais entre as colunas.
const cols = () => page.evaluate(() => {
  const w = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().width);
  return { tx: w('.side[data-role="tx"]'), pal: w('.palette'), rx: w('.side[data-role="rx"]'), blockly: Math.round(window.rc.workspaces.tx.getParentSvg().getBoundingClientRect().width) };
});
const handleAt = (col) => page.evaluate((c) => { const r = document.querySelector(`.col-handle[data-col="${c}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, col);
const c0 = await cols();
let hl = await handleAt('left');
await dragPath(hl, [{ x: hl.x + 100, y: hl.y }]);
const c1 = await cols();
check('U: alça esquerda: Controle +100, Blocos −100, Carrinho igual', Math.abs(c1.tx - c0.tx - 100) <= 2 && Math.abs(c0.pal - c1.pal - 100) <= 2 && Math.abs(c1.rx - c0.rx) <= 2 && Math.abs(c1.blockly - c1.tx) <= 2,
  `Controle ${c0.tx}→${c1.tx}, Blocos ${c0.pal}→${c1.pal}, Carrinho ${c0.rx}→${c1.rx}, área Blockly ${c1.blockly}`);
const hr = await handleAt('right');
await dragPath(hr, [{ x: hr.x + 80, y: hr.y }]);
const c2 = await cols();
check('U2: alça direita: Blocos +80, Carrinho −80, Controle igual', Math.abs(c2.pal - c1.pal - 80) <= 2 && Math.abs(c1.rx - c2.rx - 80) <= 2 && Math.abs(c2.tx - c1.tx) <= 2,
  `Blocos ${c1.pal}→${c2.pal}, Carrinho ${c1.rx}→${c2.rx}`);
await page.reload({ waitUntil: 'networkidle2' });
const c3 = await cols();
check('U3: larguras lembradas depois de recarregar', Math.abs(c3.tx - c2.tx) <= 2 && Math.abs(c3.pal - c2.pal) <= 2, `Controle ${c3.tx}, Blocos ${c3.pal}`);
hl = await handleAt('left');
await page.mouse.click(hl.x, hl.y, { count: 2 });
await new Promise((r) => setTimeout(r, 200));
const c4 = await cols();
check('U4: dois cliques voltam ao padrão', Math.abs(c4.tx - c0.tx) <= 2 && Math.abs(c4.pal - c0.pal) <= 2, `Controle ${c4.tx}, Blocos ${c4.pal}, Carrinho ${c4.rx}`);

// V: esconder um lado: vira faixa fina e o outro lado ganha o espaço.
const layout = () => page.evaluate(() => {
  const w = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().width);
  const visible = (sel) => !!document.querySelector(sel)?.offsetParent;
  return {
    hide: document.querySelector('.studio').dataset.hide || null,
    tx: w('.side[data-role="tx"]'), rx: w('.side[data-role="rx"]'), pal: w('.palette'),
    txWs: visible('#ws-tx'), rxWs: visible('#ws-rx'),
    railTx: visible('.side-rail[data-role="tx"]'), railRx: visible('.side-rail[data-role="rx"]'),
    blocklyRx: Math.round(window.rc.workspaces.rx.getParentSvg().getBoundingClientRect().width),
  };
});
const L0 = await layout();
await page.click('.side-hide[data-role="tx"]');
await new Promise((r) => setTimeout(r, 200));
const L1 = await layout();
check('V: esconder o Controle: vira faixa e o Carrinho cresce', L1.hide === 'tx' && !L1.txWs && L1.railTx && L1.tx <= 42 && L1.rx > L0.rx + 400 && Math.abs(L1.blocklyRx - L1.rx) <= 2,
  `Controle ${L0.tx}→${L1.tx}px, Carrinho ${L0.rx}→${L1.rx}px (área Blockly ${L1.blocklyRx})`);
await clickCategory('LEDs');
src = await paletteBlockRect('rc_led_toggle');
before = await count('rx', 'rc_led_toggle');
const rxWide = await wsRect('rx');
await dragPath({ x: src.x + 10, y: src.y + 10 }, [{ x: rxWide.x + rxWide.w * 0.7, y: rxWide.y + rxWide.h * 0.6 }]);
check('V2: arrastar da paleta para o Carrinho largo', (await count('rx', 'rc_led_toggle')) === before + 1);
await page.click('.side-hide[data-role="rx"]');
await new Promise((r) => setTimeout(r, 200));
const L2 = await layout();
check('V3: esconder o Carrinho troca o lado escondido', L2.hide === 'rx' && L2.txWs && !L2.rxWs && L2.railRx && L2.tx > L0.tx + 400, `Controle ${L2.tx}px, Carrinho ${L2.rx}px`);
await page.reload({ waitUntil: 'networkidle2' });
const L3 = await layout();
check('V4: lado escondido lembrado depois de recarregar', L3.hide === 'rx' && L3.railRx);
await page.click('.side-rail[data-role="rx"]');
await new Promise((r) => setTimeout(r, 200));
const L4 = await layout();
check('V5: clicar na faixa mostra os dois de novo', !L4.hide && L4.txWs && L4.rxWs && Math.abs(L4.tx - L0.tx) <= 2 && Math.abs(L4.rx - L0.rx) <= 2,
  `Controle ${L4.tx}px, Carrinho ${L4.rx}px`);

// R: clicar em qualquer lugar da barra preta abre e fecha "Mensagens".
const logState = () => page.evaluate(() => document.getElementById('log').dataset.state);
const bar = await page.evaluate(() => { const r = document.querySelector('.log-head').getBoundingClientRect(); return { x: r.right - 40, y: r.top + r.height / 2 }; });
const s0 = await logState();
await page.mouse.click(bar.x, bar.y);
const s1 = await logState();
const bar2 = await page.evaluate(() => { const r = document.querySelector('.log-head').getBoundingClientRect(); return { x: r.right - 40, y: r.top + r.height / 2 }; });
await page.mouse.click(bar2.x, bar2.y);
const s2 = await logState();
check('R: clicar na ponta direita da barra abre e fecha', s1 !== s0 && s2 === s0, `${s0} → ${s1} → ${s2}`);

if (OUT) await page.screenshot({ path: `${OUT}/e2e-2-final.png` });
console.log(results.join('\n'));
console.log(errors.length ? 'ERROS NO NAVEGADOR:\n' + errors.join('\n') : '✔ nenhum erro no console');
await browser.close();
process.exit(results.some((r) => r.startsWith('✖')) || errors.length ? 1 : 0);
