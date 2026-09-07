import test from 'node:test';
import assert from 'node:assert/strict';
import {formatTrimTime,parseTrimTime} from '../js/trim-time.js';
test('trim times display minutes and seconds with precise parsing and rollover',()=>{
  assert.equal(formatTrimTime(90.25),'01:30.25');
  assert.equal(formatTrimTime(59.999),'01:00.00');
  assert.equal(parseTrimTime('01:30.25'),90.25);
  assert.equal(parseTrimTime('20:00'),1200);
  for(const invalid of ['90','01:60','-1:00','abc','00:01.234']) assert.ok(Number.isNaN(parseTrimTime(invalid)));
});
