import test from 'node:test';
import assert from 'node:assert/strict';
import {SUBTITLE_FONTS,subtitleFontFamily} from '../js/fonts.js';
import {validateSettings} from '../js/settings.js';
test('font choices persist with safe local fallback for invalid values',()=>{
 for(const key of Object.keys(SUBTITLE_FONTS)) {
  assert.equal(validateSettings({subtitleFont:key}).subtitleFont,key);
  assert.equal(subtitleFontFamily(key),SUBTITLE_FONTS[key]);
 }
 assert.equal(validateSettings({subtitleFont:'invalid'}).subtitleFont,'system');
 assert.equal(subtitleFontFamily('invalid'),SUBTITLE_FONTS.system);
});
