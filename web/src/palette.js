// Paleta central de blocos, compartilhada pelo Controle e pelo Carrinho.
//
// - Em cima: grade de categorias. Embaixo: os blocos da categoria escolhida,
//   desenhados por um Blockly "vitrine" (dá para mudar os valores antes de
//   arrastar, como numa toolbox normal).
// - Arrastar: enquanto o mouse está fora dos lados, uma "sombra" do bloco
//   segue o ponteiro. Ao entrar no Controle ou no Carrinho, o bloco de verdade
//   é criado ali e o próprio Blockly assume o arrasto (encaixe, prévia de
//   encaixe e lixeira funcionam normalmente).
// - Blocos que só existem num lado (ex.: joystick só no Controle, motor só no
//   Carrinho) não entram no lado errado.
import * as Blockly from 'blockly';
import { toolboxTx, toolboxRx } from './toolbox.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DRAG_START_PX = 5;
const ROLE_LABEL = { tx: '🎮 Controle', rx: '🚗 Carrinho' };
// Cores das categorias padrão do Blockly (tema clássico).
const STYLE_HUES = { logic_category: 210, loop_category: 120, math_category: 230, variable_category: 330 };

// ------------------------------------------------------------------ Categorias

// Junta as duas toolboxes numa lista só, lembrando em quais lados cada
// categoria e cada bloco existem. Itens de um lado só entram logo depois
// do item anterior daquele lado, para manter a ordem natural.
function mergeInto(list, entry, prevKey, keyOf) {
  const i = prevKey ? list.findIndex((x) => keyOf(x) === prevKey) : -1;
  list.splice(i + 1, 0, entry);
}

function buildCategories() {
  const cats = [];
  for (const [role, toolbox] of [['tx', toolboxTx], ['rx', toolboxRx]]) {
    let prevCat = null;
    for (const c of toolbox.contents) {
      if (c.kind !== 'category') continue;
      let cat = cats.find((x) => x.name === c.name);
      if (!cat) {
        const hue = c.colour ?? STYLE_HUES[c.categorystyle] ?? 0;
        cat = { name: c.name, colour: Blockly.utils.colour.hueToHex(Number(hue)), custom: c.custom, items: [], roles: new Set() };
        mergeInto(cats, cat, prevCat, (x) => x.name);
      }
      cat.roles.add(role);
      prevCat = c.name;

      let prevItem = null;
      for (const raw of c.contents || []) {
        if (raw.kind !== 'block') continue;
        const { kind, ...state } = raw;
        const key = JSON.stringify(state);
        let item = cat.items.find((x) => x.key === key);
        if (!item) {
          item = { key, state, roles: new Set() };
          mergeInto(cat.items, item, prevItem, (x) => x.key);
        }
        item.roles.add(role);
        prevItem = key;
      }
    }
  }
  return cats;
}

// Variáveis guardam só o nome; ao soltar, a variável é criada no lado de
// destino se ainda não existir (cada lado tem as suas).
function stripVariableIds(node) {
  if (Array.isArray(node)) return node.forEach(stripVariableIds);
  if (!node || typeof node !== 'object') return;
  if (typeof node.name === 'string' && 'id' in node && Object.keys(node).every((k) => ['id', 'name', 'type'].includes(k))) {
    delete node.id;
  }
  for (const v of Object.values(node)) stripVariableIds(v);
}

// ------------------------------------------------------------------ Sombra do bloco

// Cópia visual de um bloco, solta na página (por cima de tudo). Usada quando
// o bloco está fora da área onde ele é desenhado: arrastando da paleta, ou
// arrastando um bloco do Controle/Carrinho por cima da paleta/outro lado.
function makeGhost(block, origin, sourceWs) {
  const clone = block.getSvgRoot().cloneNode(true);
  clone.removeAttribute('transform');
  clone.removeAttribute('data-id');
  for (const n of [clone, ...clone.querySelectorAll('[id]')]) n.removeAttribute('id');

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', sourceWs.getParentSvg().getAttribute('class') || '');
  svg.setAttribute('width', '1');
  svg.setAttribute('height', '1');
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('transform', `scale(${sourceWs.scale})`);
  g.append(clone);
  svg.append(g);

  const wrap = document.createElement('div');
  // Classes do renderizador/tema, para o bloco clonado ficar com o mesmo visual.
  wrap.className = ['palette-ghost', ...sourceWs.getInjectionDiv().classList].filter((c) => c !== 'injectionDiv').join(' ');
  wrap.style.left = `${origin.x}px`;
  wrap.style.top = `${origin.y}px`;
  const label = document.createElement('div');
  label.className = 'palette-ghost-label';
  wrap.append(svg, label);
  document.body.append(wrap);
  return { wrap, label };
}

// Bloco do Controle/Carrinho arrastado para fora do seu lado: o Blockly só o
// desenha dentro do próprio lado, então mostramos uma sombra que segue o mouse.
let pointer = { x: 0, y: 0 };
let outside = null; // { ghost, startPointer }
document.addEventListener(
  'pointermove',
  (e) => {
    pointer = { x: e.clientX, y: e.clientY };
    if (outside) {
      const dx = pointer.x - outside.startPointer.x;
      const dy = pointer.y - outside.startPointer.y;
      outside.ghost.wrap.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  },
  true,
);

function showOutsideGhost(element, kind) {
  hideOutsideGhost();
  if (!(element instanceof Blockly.BlockSvg)) return;
  const origin = Blockly.utils.svgMath.wsToScreenCoordinates(element.workspace, element.getRelativeToSurfaceXY());
  const ghost = makeGhost(element, origin, element.workspace);
  ghost.wrap.classList.add(kind);
  outside = { ghost, startPointer: { ...pointer } };
}

function hideOutsideGhost() {
  outside?.ghost.wrap.remove();
  outside = null;
}

// ------------------------------------------------------------------ Soltar fora do lugar

const rectOf = (el) => {
  const r = el.getBoundingClientRect();
  return new Blockly.utils.Rect(r.top, r.bottom, r.left, r.right);
};

// Arrastar um bloco do Controle/Carrinho para a paleta apaga o bloco (como a
// toolbox normal do Blockly). Sem isso ele ficaria escondido atrás da paleta.
class PaletteTrash extends Blockly.DeleteArea {
  constructor(el) {
    super();
    this.id = 'rcPaletteTrash';
    this.el = el;
  }
  getClientRect() {
    return rectOf(this.el);
  }
  onDragEnter(element) {
    const deleting = this.wouldDelete(element);
    this.el.classList.toggle('drop-delete', deleting);
    showOutsideGhost(element, deleting ? 'deleting' : 'blocked');
  }
  onDragExit() {
    this.el.classList.remove('drop-delete');
    hideOutsideGhost();
  }
  onDrop() {
    this.el.classList.remove('drop-delete');
    hideOutsideGhost();
  }
}

// Soltar um bloco em cima do OUTRO lado: o bloco volta para onde estava
// (cada lado tem seu programa; para usar lá, arraste da paleta).
class OtherSide extends Blockly.DragTarget {
  constructor(el, notify, otherLabel) {
    super();
    this.id = 'rcOtherSide';
    this.el = el;
    this.notify = notify;
    this.otherLabel = otherLabel;
  }
  getClientRect() {
    return rectOf(this.el);
  }
  shouldPreventMove() {
    return true;
  }
  onDragEnter(element) {
    showOutsideGhost(element, 'blocked');
  }
  onDragExit() {
    hideOutsideGhost();
  }
  onDrop() {
    hideOutsideGhost();
    this.notify(`Cada lado tem o seu programa. Para usar no ${this.otherLabel}, arraste o bloco da paleta do meio.`);
  }
}

function registerDropAreas(targets, paletteEl, notify) {
  const { DRAG_TARGET, DELETE_AREA } = Blockly.ComponentManager.Capability;
  for (const [role, t] of Object.entries(targets)) {
    const otherRole = role === 'tx' ? 'rx' : 'tx';
    const manager = t.ws.getComponentManager();
    manager.addComponent({ component: new PaletteTrash(paletteEl), weight: 1, capabilities: [DELETE_AREA, DRAG_TARGET] });
    manager.addComponent({
      component: new OtherSide(targets[otherRole].el, notify, ROLE_LABEL[otherRole].slice(3)),
      weight: 2,
      capabilities: [DRAG_TARGET],
    });
  }
}

// ------------------------------------------------------------------ Paleta

export function initPalette({ catsEl, toolsEl, wsEl, targets, notify }) {
  registerDropAreas(targets, catsEl.closest('.palette'), notify);
  const categories = buildCategories();
  const extraVariables = new Set();
  const rolesOf = new Map(); // id do bloco na vitrine -> lados permitidos
  let currentCat = categories[0];

  const ws = Blockly.inject(wsEl, {
    renderer: 'zelos',
    trashcan: false,
    sounds: false,
    move: { scrollbars: { horizontal: false, vertical: true }, drag: false, wheel: true },
    zoom: { controls: false, wheel: false, startScale: 0.7 },
  });

  // -------------------------------------------------- grade de categorias
  for (const cat of categories) {
    const btn = document.createElement('button');
    btn.className = 'cat-btn';
    btn.style.setProperty('--cat', cat.colour);
    const only = cat.roles.size === 1 ? [...cat.roles][0] : null;
    btn.innerHTML = `<span class="cat-name"></span>${only ? `<span class="cat-only" title="Só ${ROLE_LABEL[only].slice(3)}">${ROLE_LABEL[only].slice(0, 2)}</span>` : ''}`;
    btn.querySelector('.cat-name').textContent = cat.name;
    btn.title = only ? `${cat.name} (só no ${ROLE_LABEL[only].slice(3)})` : cat.name;
    btn.addEventListener('click', () => show(cat));
    cat.button = btn;
    catsEl.append(btn);
  }

  // -------------------------------------------------- variáveis
  function variableNames() {
    const names = new Set(extraVariables);
    for (const t of Object.values(targets)) {
      for (const v of t.ws.getVariableMap().getAllVariables()) names.add(v.getName());
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  function variableItems() {
    const names = variableNames();
    if (!names.length) return [];
    const both = new Set(['tx', 'rx']);
    const v = (name) => ({ VAR: { name } });
    const num = (n) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
    return [
      { state: { type: 'variables_set', fields: v(names[0]), inputs: { VALUE: num(0) } }, roles: both },
      { state: { type: 'math_change', fields: v(names[0]), inputs: { DELTA: num(1) } }, roles: both },
      ...names.map((name) => ({ state: { type: 'variables_get', fields: v(name) }, roles: both })),
    ];
  }

  function renderTools() {
    toolsEl.innerHTML = '';
    if (!currentCat.custom) {
      toolsEl.hidden = true;
      return;
    }
    toolsEl.hidden = false;
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = '➕ Criar variável';
    btn.addEventListener('click', () => {
      const name = (prompt('Nome da nova variável:') || '').trim();
      if (!name) return;
      extraVariables.add(name);
      show(currentCat);
    });
    const hint = document.createElement('span');
    hint.className = 'palette-hint';
    hint.textContent = variableNames().length ? 'Variáveis são separadas em cada lado.' : 'Crie uma variável para começar.';
    toolsEl.append(btn, hint);
  }

  // -------------------------------------------------- blocos da categoria
  function show(cat) {
    currentCat = cat;
    for (const c of categories) c.button.classList.toggle('active', c === cat);
    renderTools();

    const items = cat.custom === 'VARIABLE' ? variableItems() : cat.items;
    Blockly.Events.disable();
    try {
      ws.clear();
      rolesOf.clear();
      shown = [];
      for (const item of items) {
        const block = Blockly.serialization.blocks.append(structuredClone(item.state), ws);
        block.setMovable(false);
        block.setDeletable(false);
        block.contextMenu = false;
        rolesOf.set(block.id, item.roles);
        shown.push(block);
      }
      layout();
    } finally {
      Blockly.Events.enable();
    }
    ws.scroll(0, 0);
  }

  // Empilha os blocos da vitrine. Roda de novo quando um bloco muda de
  // tamanho ali mesmo (ex.: ➕/➖ do "enviar canais"), para não sobrepor.
  let shown = [];
  function layout() {
    Blockly.renderManagement.triggerQueuedRenders();
    let y = 12;
    for (const block of shown) {
      if (block.hat) y += 20; // topo arredondado dos chapéus
      const pos = block.getRelativeToSurfaceXY();
      block.moveBy(12 - pos.x, y - pos.y);
      y += block.getHeightWidth().height + 16;
    }
  }
  ws.addChangeListener((e) => {
    if (e.type === Blockly.Events.BLOCK_CHANGE && e.element === 'mutation') layout();
  });

  // Atualiza a lista de variáveis quando algum lado cria/renomeia/apaga.
  for (const t of Object.values(targets)) {
    t.ws.addChangeListener((e) => {
      if (currentCat.custom === 'VARIABLE' && [Blockly.Events.VAR_CREATE, Blockly.Events.VAR_RENAME, Blockly.Events.VAR_DELETE].includes(e.type)) {
        show(currentCat);
      }
    });
  }

  // -------------------------------------------------- arrastar
  let pending = null; // pointerdown num bloco, esperando o mouse andar
  let drag = null;

  function targetAt(e) {
    for (const [role, t] of Object.entries(targets)) {
      const r = t.el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return role;
    }
    return null;
  }

  // Onde o bloco deve ficar (coordenadas do lado de destino) para o ponteiro
  // continuar "segurando" o mesmo ponto do bloco.
  function blockPositionAt(targetWs, e) {
    const ratio = targetWs.scale / ws.scale;
    const screen = new Blockly.utils.Coordinate(e.clientX - drag.grab.x * ratio, e.clientY - drag.grab.y * ratio);
    return Blockly.utils.svgMath.screenToWsCoordinates(targetWs, screen);
  }

  function moveGhost(e) {
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    drag.ghost.wrap.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function startDrag(e) {
    // O Blockly da vitrine também começou um "gesto" no pointerdown. Se ele
    // continuar vivo, passa a arrastar o bloco novo junto com a gente (dois
    // arrastos brigando, e o encaixe falha). A partir daqui, o arrasto é nosso.
    ws.cancelCurrentGesture();
    const block = pending.block;
    const origin = Blockly.utils.svgMath.wsToScreenCoordinates(ws, block.getRelativeToSurfaceXY());
    const state = Blockly.serialization.blocks.save(block, { addCoordinates: false, saveIds: false, doFullSerialization: true });
    // Na vitrine os blocos são travados; a cópia sai destravada.
    delete state.movable;
    delete state.deletable;
    stripVariableIds(state);
    drag = {
      state,
      roles: rolesOf.get(block.id) || new Set(),
      startX: pending.x,
      startY: pending.y,
      // Onde o ponteiro pegou o bloco, em pixels da vitrine.
      grab: { x: pending.x - origin.x, y: pending.y - origin.y },
      ghost: makeGhost(block, origin, ws),
      active: null, // { role, ws, block, dragger, sx, sy }
    };
    document.body.classList.add('palette-dragging');
    pending = null;
  }

  // O bloco é criado "em silêncio" (fora do histórico de desfazer); só entra
  // no histórico quando for solto de verdade (ver endDrag).
  function enterTarget(role, e) {
    const t = targets[role];
    let block;
    Blockly.Events.disable();
    try {
      block = Blockly.serialization.blocks.append(structuredClone(drag.state), t.ws);
      Blockly.renderManagement.triggerQueuedRenders();
      block.moveTo(blockPositionAt(t.ws, e));
      // O Blockly só registra os encaixes de um bloco novo 1 ms depois; o
      // arrasto começa agora, então registramos já (ligar de novo não faz nada).
      block.setConnectionTracking(true);
    } finally {
      Blockly.Events.enable();
    }
    // Onde ficam a lixeira e outras áreas de soltar (o arrasto normal do
    // Blockly faz isso sozinho ao começar).
    t.ws.recordDragTargets();
    // O Blockly rola a área de trabalho para mostrar o bloco inteiro quando ele
    // ganha foco. Como o bloco nasce na borda, isso deslocaria tudo no meio do
    // arrasto (e o encaixe erraria o alvo). Desligado só durante o arrasto.
    t.ws.scrollBoundsIntoView = () => {};
    Blockly.Events.setGroup(true);
    const dragger = new Blockly.dragging.Dragger(block);
    dragger.onDragStart(e);
    drag.active = { role, ws: t.ws, block, dragger, startLoc: block.getRelativeToSurfaceXY() };
    drag.ghost.wrap.hidden = true;
  }

  // Saiu do lado sem soltar: desfaz o bloco e volta a mostrar a sombra.
  function restoreScrolling(targetWs) {
    delete targetWs.scrollBoundsIntoView; // volta ao método normal do Blockly
  }

  function leaveTarget(e) {
    const a = drag.active;
    Blockly.Events.disable();
    try {
      a.dragger.onDragRevert(e);
      a.block.dispose(false);
    } finally {
      Blockly.Events.enable();
      restoreScrolling(a.ws);
    }
    Blockly.Events.setGroup(false);
    drag.active = null;
    drag.ghost.wrap.hidden = false;
  }

  function updateDrag(e) {
    const over = targetAt(e);
    if (drag.active && over !== drag.active.role) leaveTarget(e);
    if (!drag.active && over && drag.roles.has(over)) enterTarget(over, e);

    if (drag.active) {
      // O deslocamento é calculado a partir da posição desejada (e não de
      // "quanto o mouse andou"), assim fica certo mesmo se a área de trabalho
      // se reajustar durante o arrasto. É isso que faz o encaixe funcionar.
      const a = drag.active;
      const want = blockPositionAt(a.ws, e);
      const delta = new Blockly.utils.Coordinate((want.x - a.startLoc.x) * a.ws.scale, (want.y - a.startLoc.y) * a.ws.scale);
      a.dragger.onDrag(e, delta);
      return;
    }
    const invalid = over && !drag.roles.has(over);
    drag.ghost.wrap.classList.toggle('invalid', Boolean(invalid));
    drag.ghost.label.textContent = invalid ? `Este bloco é só do ${ROLE_LABEL[[...drag.roles][0]].slice(3)}` : '';
    moveGhost(e);
  }

  function endDrag(e, cancelled = false) {
    if (drag.active) {
      if (cancelled) leaveTarget(e);
      else {
        // Agora sim o bloco "nasce" no histórico (desfazer remove ele).
        Blockly.Events.fire(new Blockly.Events.BlockCreate(drag.active.block));
        try {
          drag.active.dragger.onDragEnd(e);
        } finally {
          Blockly.Events.setGroup(false);
          restoreScrolling(drag.active.ws);
        }
      }
    } else if (!cancelled) {
      const over = targetAt(e);
      if (over && !drag.roles.has(over)) notify(`Este bloco é só do ${ROLE_LABEL[[...drag.roles][0]].slice(3)}.`);
    }
    drag.ghost.wrap.remove();
    document.body.classList.remove('palette-dragging');
    drag = null;
  }

  function onMove(e) {
    if (pending && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > DRAG_START_PX) startDrag(e);
    if (drag) {
      e.preventDefault();
      updateDrag(e);
    }
  }

  function onUp(e) {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    pending = null;
    if (drag) endDrag(e);
  }

  function onCancel(e) {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    pending = null;
    if (drag) endDrag(e, true);
  }

  ws.getParentSvg().addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 || drag) return;
      const el = e.target.closest?.('[data-id]');
      const hit = el && ws.getBlockById(el.getAttribute('data-id'));
      if (!hit) return;
      pending = { block: hit.getRootBlock(), x: e.clientX, y: e.clientY };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
    },
    true,
  );

  show(currentCat);
  return { workspace: ws, refresh: () => show(currentCat) };
}
