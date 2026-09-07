import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const board = require('../Quareia/Resources/www/js/free-board-ui.js');

test('accessible board zoom changes the bounded viewport, supports undo and reset, and respects backup ownership', context => {
  const previousI18n = globalThis.DivinationI18n;
  globalThis.DivinationI18n = { t: (key, values) => key === 'freeBoard.zoomLevel' ? `Board zoom: ${values.percent}%` : key };
  context.after(() => {
    if (previousI18n === undefined) delete globalThis.DivinationI18n;
    else globalThis.DivinationI18n = previousI18n;
  });
  function button() {
    const listeners = new Map();
    return {
      disabled: false,
      addEventListener(type, callback) { listeners.set(type, callback); },
      click() { if (!this.disabled) listeners.get('click')?.(); }
    };
  }
  const controls = {
    freeBoardZoomStatus: { textContent: '', setAttribute() {} },
    freeBoardZoomInBtn: button(),
    freeBoardZoomOutBtn: button(),
    freeBoardResetViewBtn: button()
  };
  const storage = new Map();
  const ui = board.createController({
    document: { getElementById: id => controls[id] || null },
    storage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    platform: 'ios'
  });
  ui.enter({
    deckType: 'tarot', deckName: 'Synthetic deck', mode: 'upright-only',
    filterMode: 'mixed', cards: [{ id: 'major-0', deck: 'tarot', name: 'Synthetic card' }]
  }, { restoreDraft: false });
  const initial = ui.getState().viewport;
  controls.freeBoardZoomInBtn.click();
  assert.equal(ui.getState().viewport.zoom, 1.25);
  assert.equal(controls.freeBoardZoomStatus.textContent, 'Board zoom: 125%');
  assert.equal(ui.getState().viewport.panX, 0);
  assert.equal(ui.getState().viewport.panY, 0);
  ui.undo();
  assert.deepEqual(ui.getState().viewport, initial);
  ui.redo();
  assert.equal(ui.getState().viewport.zoom, 1.25);
  controls.freeBoardZoomOutBtn.click();
  assert.deepEqual(ui.getState().viewport, initial);
  for (let i = 0; i < 50; i++) controls.freeBoardZoomInBtn.click();
  assert.equal(controls.freeBoardZoomInBtn.disabled, true);
  assert.equal(ui.getState().viewport.zoom, ui.clampZoom(Number.MAX_VALUE));
  for (let i = 0; i < 50; i++) controls.freeBoardZoomOutBtn.click();
  assert.equal(controls.freeBoardZoomOutBtn.disabled, true);
  assert.equal(ui.getState().viewport.zoom, ui.clampZoom(0));
  controls.freeBoardResetViewBtn.click();
  assert.deepEqual(ui.getState().viewport, initial);
  assert.equal(controls.freeBoardZoomStatus.textContent, 'Board zoom: 100%');
  assert.equal(controls.freeBoardZoomInBtn.disabled, false);
  assert.equal(controls.freeBoardZoomOutBtn.disabled, false);
  const previousBackup = globalThis.DivinationBackup;
  try {
    globalThis.DivinationBackup = { isMutating: () => true };
    controls.freeBoardZoomInBtn.click();
    assert.deepEqual(ui.getState().viewport, initial);
  } finally {
    if (previousBackup === undefined) delete globalThis.DivinationBackup;
    else globalThis.DivinationBackup = previousBackup;
  }
});

test('iOS touch drag commits before toolbar undo redo and zoom without cancelling touch defaults', context => {
  const previousI18n = globalThis.DivinationI18n;
  const i18n = require('../Quareia/Resources/www/js/i18n.js');
  globalThis.DivinationI18n = { t: (key, values) => i18n.tForLocale('en', key, values) };
  context.after(() => {
    if (previousI18n === undefined) delete globalThis.DivinationI18n;
    else globalThis.DivinationI18n = previousI18n;
  });
  const selectionStatus = { textContent: '' };
  let selectedAction;
  const selected = { hidden: true, setAttribute() {}, querySelectorAll: () => [],
    addEventListener: (_, callback) => { selectedAction = callback; } };
  const listeners = new Map();
  let zoomClick;
  const viewport = {
    addEventListener: (type, callback) => listeners.set(type, callback),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
    setPointerCapture() {}, releasePointerCapture() {}
  };
  const zoomIn = { disabled: false, addEventListener: (_, callback) => { zoomClick = callback; } };
  const storage = new Map();
  const ui = board.createController({
    document: { getElementById: id => ({ freeBoardViewport: viewport, freeBoardZoomInBtn: zoomIn, freeBoardSelectedControls: selected, freeBoardSelectionStatus: selectionStatus })[id] || null },
    storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    platform: 'ios'
  });
  ui.enter({ deckType: 'tarot', deckName: 'Synthetic', mode: 'upright-only', filterMode: 'mixed',
    cards: [{ id: 'major-0', deck: 'tarot', name: 'Synthetic' }] }, { restoreDraft: false });
  ui.draw('major-0');
  const original = ui.getState().cards[0];
  assert.equal(selectionStatus.textContent, '', 'drawing does not select a card');
  assert.equal(i18n.tForLocale('zh-CN', 'freeBoard.selectionPosition', {x: -50, y: 54, rotation: 15}), '卡牌位置：X -50，Y 54。旋转角度：15 度。');
  const target = { getAttribute: name => name === 'data-card-id' ? 'major-0' : null };
  let cancelledDefaults = 0;
  const event = (x, y, pointerType = 'touch') => ({
    pointerId: 1, pointerType, button: 0, clientX: x, clientY: y, target, currentTarget: viewport,
    preventDefault: () => { cancelledDefaults++; }
  });
  listeners.get('pointerdown')(event(200, 200));
  const initialPosition = selectionStatus.textContent;
  assert.match(initialPosition, /^Card position: X -?[0-9]+, Y -?[0-9]+[.] Rotation: 0 degrees[.]$/);
  listeners.get('pointermove')(event(242, 254));
  assert.equal(ui.getState().cards[0].x, original.x, 'drag preview is not committed yet');
  assert.equal(selectionStatus.textContent, initialPosition, 'do not announce uncommitted drag preview');
  listeners.get('pointerup')(event(242, 254));
  const moved = ui.getState().cards[0];
  assert.equal(moved.x, original.x + 42);
  assert.equal(moved.y, original.y + 54);
  assert.equal(cancelledDefaults, 0);
  const movedPosition = 'Card position: X ' + Math.round(original.x + 42) + ', Y ' + Math.round(original.y + 54) + '. Rotation: 0 degrees.';
  assert.equal(selectionStatus.textContent, movedPosition);
  ui.undo();
  assert.equal(ui.getState().cards[0].x, original.x);
  assert.equal(selectionStatus.textContent, initialPosition);
  ui.redo();
  assert.equal(ui.getState().cards[0].x, moved.x);
  assert.equal(selectionStatus.textContent, movedPosition);
  selectedAction({target: {getAttribute: key => key === 'data-card-control-action' ? 'rotate-plus-15' : null}});
  assert.equal(selectionStatus.textContent, movedPosition.replace('Rotation: 0', 'Rotation: 15'));
  zoomClick();
  assert.equal(ui.getState().viewport.zoom, 1.25);
  listeners.get('pointerdown')(event(200, 200, 'mouse'));
  listeners.get('pointerup')(event(200, 200, 'mouse'));
  assert.ok(cancelledDefaults > 0, 'mouse defaults keep the existing behavior');
  selectedAction({target: {getAttribute: key => key === 'data-card-control-action' ? 'remove' : null}});
  assert.equal(selectionStatus.textContent, '', 'clear status when no card is selected');
  assert.equal(selected.hidden, true);
  ui.exit();
});

test('iOS history controls activate a primary touch once and preserve keyboard mouse and pen clicks', () => {
  function control() {
    const listeners = new Map();
    return { disabled: false, listeners,
      addEventListener(type, callback) { listeners.set(type, callback); },
      getBoundingClientRect: () => ({left: 0, top: 0, right: 100, bottom: 50}),
      emit(type, options = {}) {
        let prevented = false;
        listeners.get(type)?.({pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0,
          clientX: 20, clientY: 20, detail: 1, preventDefault() { prevented = true; }, ...options});
        return prevented;
      }
    };
  }
  const undo = control();
  const redo = control();
  const ui = board.createController({platform: 'ios', draftApi: {},
    document: {getElementById: id => ({freeBoardUndoBtn: undo, freeBoardRedoBtn: redo})[id] || null}});
  ui.enter({deckType: 'tarot', deckName: 'Synthetic', mode: 'upright-only', filterMode: 'mixed',
    cards: ['major-0', 'major-1', 'major-2'].map(id => ({id, deck: 'tarot', name: 'Synthetic'}))}, {restoreDraft: false});
  for (const id of ['major-0', 'major-1', 'major-2']) ui.draw(id);
  const count = () => ui.getState().cards.length;
  assert.equal(undo.emit('pointerdown'), false, 'touch down must not block scrolling');
  assert.equal(undo.emit('pointerup'), false);
  assert.equal(count(), 2);
  undo.emit('pointerup');
  assert.equal(count(), 2, 'duplicate pointerup cannot repeat Undo');
  assert.equal(undo.emit('click'), true);
  assert.equal(count(), 2, 'compatibility click cannot repeat Undo');
  undo.emit('click');
  assert.equal(count(), 2, 'duplicate compatibility clicks from the same touch remain suppressed');
  redo.emit('pointerdown'); redo.emit('pointerup'); redo.emit('click');
  assert.equal(count(), 3, 'Redo also activates exactly once');
  undo.emit('click', {detail: 0});
  assert.equal(count(), 2, 'keyboard and VoiceOver detail-zero activation remains usable');
  undo.emit('pointerdown', {pointerType: 'mouse'}); undo.emit('pointerup', {pointerType: 'mouse'});
  assert.equal(count(), 2, 'mouse activation remains click-driven');
  undo.emit('click', {pointerType: 'mouse'});
  assert.equal(count(), 1);
  redo.emit('pointerdown', {pointerType: 'pen'}); redo.emit('pointerup', {pointerType: 'pen'});
  assert.equal(count(), 1, 'pen activation remains click-driven');
  redo.emit('click', {pointerType: 'pen'}); redo.emit('click', {detail: 0});
  assert.equal(count(), 3);
  undo.emit('pointerdown'); undo.emit('pointercancel'); undo.emit('pointerup'); undo.emit('click');
  assert.equal(count(), 3, 'cancelled touch cannot activate via a later compatibility click');
  assert.equal(undo.emit('pointerdown'), false);
  assert.equal(undo.emit('pointermove', {clientX: 40}), false, 'scrolling movement is not cancelled');
  undo.emit('pointerup'); undo.emit('click');
  assert.equal(count(), 3, 'moving away and returning cannot activate');
  undo.emit('pointerdown', {clientX: 98}); undo.emit('pointerup', {clientX: 102}); undo.emit('click');
  assert.equal(count(), 3, 'release outside the control cannot activate even below movement threshold');
  undo.emit('pointerdown', {isPrimary: false}); undo.emit('pointerup', {isPrimary: false}); undo.emit('click');
  assert.equal(count(), 3, 'secondary touch cannot activate');
  undo.disabled = true;
  undo.emit('pointerdown'); undo.emit('pointerup'); undo.emit('click', {detail: 0});
  assert.equal(count(), 3, 'disabled controls cannot activate');
  undo.disabled = false;
  undo.emit('pointerdown'); undo.emit('pointerup');
  assert.equal(count(), 2);
  undo.emit('click', {detail: 0});
  assert.equal(count(), 1, 'VoiceOver activation is not consumed when a touch emitted no compatibility click');
  ui.exit();
});
