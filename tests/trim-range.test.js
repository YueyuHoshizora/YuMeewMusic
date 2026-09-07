import test from 'node:test';
import assert from 'node:assert/strict';
import {moveTrimRange} from '../js/trim-range.js';
test('drag moves whole selection without changing duration or escaping audio boundaries',()=>{
  assert.deepEqual(moveTrimRange(10,30,5,60,'body'),[15,35]);
  assert.deepEqual(moveTrimRange(10,30,-99,60,'body'),[0,20]);
  assert.deepEqual(moveTrimRange(10,30,99,60,'body'),[40,60]);
});
test('drag handles cannot cross or exceed audio boundaries',()=>{
  assert.deepEqual(moveTrimRange(10,30,-99,60,'start'),[0,30]);
  assert.deepEqual(moveTrimRange(10,30,99,60,'end'),[10,60]);
  assert.deepEqual(moveTrimRange(10,30,99,60,'start'),[29.99,30]);
  assert.deepEqual(moveTrimRange(10,30,-99,60,'end'),[10,10.01]);
});
