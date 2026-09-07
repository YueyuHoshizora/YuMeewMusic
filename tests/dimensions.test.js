import test from 'node:test';
import assert from 'node:assert/strict';
import { videoDimensions } from '../js/dimensions.js';
import { validateSettings } from '../js/settings.js';

test('landscape and portrait dimensions are exact at both export resolutions', () => {
  assert.deepEqual(videoDimensions('720', '16:9'), {width:1280,height:720});
  assert.deepEqual(videoDimensions('1080', '16:9'), {width:1920,height:1080});
  assert.deepEqual(videoDimensions('720', '9:16'), {width:720,height:1280});
  assert.deepEqual(videoDimensions('1080', '9:16'), {width:1080,height:1920});
  assert.throws(()=>videoDimensions('1080','1:1'));
  assert.equal(validateSettings({}).aspectRatio,'16:9');
  assert.equal(validateSettings({aspectRatio:'9:16'}).aspectRatio,'9:16');
});
