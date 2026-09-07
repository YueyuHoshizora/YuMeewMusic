import test from 'node:test';
import assert from 'node:assert/strict';
import { createUndoHistory } from '../js/undo-history.js';

test('subtitle history keeps only ten undo operations and supports redo', () => {
  const history = createUndoHistory(10);
  for (let value = 0; value < 12; value++) history.checkpoint({ value });
  assert.equal(history.undoCount, 10);
  let current = { value: 12 };
  for (const expected of [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) {
    const restored = history.undo(current);
    current = restored;
    assert.equal(restored.value, expected);
  }
  assert.equal(history.undo(current), null);
  const redone = history.redo(current);
  assert.equal(redone.value, 3);
  assert.equal(history.canUndo, true);
});

test('a new subtitle edit clears redo history and snapshots are independent', () => {
  const history = createUndoHistory(10);
  const original = { cues: [{ text: '甲' }] };
  history.checkpoint(original);
  original.cues[0].text = '乙';
  const restored = history.undo(original);
  assert.equal(restored.cues[0].text, '甲');
  history.checkpoint({ cues: [{ text: '丙' }] });
  assert.equal(history.canRedo, false);
});
