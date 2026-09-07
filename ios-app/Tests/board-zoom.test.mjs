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

test('iOS touch drag commits before toolbar undo redo and zoom without cancelling touch defaults', () => {
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
    document: { getElementById: id => ({ freeBoardViewport: viewport, freeBoardZoomInBtn: zoomIn })[id] || null },
    storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    platform: 'ios'
  });
  ui.enter({ deckType: 'tarot', deckName: 'Synthetic', mode: 'upright-only', filterMode: 'mixed',
    cards: [{ id: 'major-0', deck: 'tarot', name: 'Synthetic' }] }, { restoreDraft: false });
  ui.draw('major-0');
  const original = ui.getState().cards[0];
  const target = { getAttribute: name => name === 'data-card-id' ? 'major-0' : null };
  let cancelledDefaults = 0;
  const event = (x, y, pointerType = 'touch') => ({
    pointerId: 1, pointerType, button: 0, clientX: x, clientY: y, target, currentTarget: viewport,
    preventDefault: () => { cancelledDefaults++; }
  });
  listeners.get('pointerdown')(event(200, 200));
  listeners.get('pointermove')(event(242, 254));
  assert.equal(ui.getState().cards[0].x, original.x, 'drag preview is not committed yet');
  listeners.get('pointerup')(event(242, 254));
  const moved = ui.getState().cards[0];
  assert.equal(moved.x, original.x + 42);
  assert.equal(moved.y, original.y + 54);
  assert.equal(cancelledDefaults, 0);
  ui.undo();
  assert.equal(ui.getState().cards[0].x, original.x);
  ui.redo();
  assert.equal(ui.getState().cards[0].x, moved.x);
  zoomClick();
  assert.equal(ui.getState().viewport.zoom, 1.25);
  listeners.get('pointerdown')(event(200, 200, 'mouse'));
  listeners.get('pointerup')(event(200, 200, 'mouse'));
  assert.ok(cancelledDefaults > 0, 'mouse defaults keep the existing behavior');
  ui.exit();
});
