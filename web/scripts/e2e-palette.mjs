// Teste de navegador da paleta central (arrastar blocos para o Controle e o
// Carrinho). Precisa do Chrome instalado e do app rodando.
// Uso: npm run test:e2e   (variáveis: CHROME, URL, SCREENSHOTS)
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

if (OUT) await page.screenshot({ path: `${OUT}/e2e-2-final.png` });
console.log(results.join('\n'));
console.log(errors.length ? 'ERROS NO NAVEGADOR:\n' + errors.join('\n') : '✔ nenhum erro no console');
await browser.close();
process.exit(results.some((r) => r.startsWith('✖')) || errors.length ? 1 : 0);
