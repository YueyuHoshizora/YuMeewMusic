import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
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

test('bundled fonts are available to every font selector',()=>{
 const html=readFileSync('index.html','utf8');
 const css=readFileSync('css/style.css','utf8');
 assert.equal((html.match(/value="jasonRounded"/g)||[]).length,2);
 assert.equal(SUBTITLE_FONTS.jasonRounded,'"YuMeew Jason Handwriting Rounded", "Microsoft JhengHei", sans-serif');
 assert.match(css,/url\("\.\/fonts\/jason-handwriting-rounded\.ttf"\)/);
 assert.ok(existsSync('css/fonts/jason-handwriting-rounded.ttf'));
 assert.equal(validateSettings({subtitleFont:'jasonRounded',identityFont:'jasonRounded'}).identityFont,'jasonRounded');
 assert.equal((html.match(/value="bakudai"/g)||[]).length,2);
 assert.equal(SUBTITLE_FONTS.bakudai,'"YuMeew Bakudai", "Microsoft JhengHei", sans-serif');
 assert.match(css,/url\("\.\/fonts\/bakudai-regular\.woff2"\)/);
 assert.ok(existsSync('css/fonts/bakudai-regular.woff2'));
 assert.equal(validateSettings({subtitleFont:'bakudai',identityFont:'bakudai'}).identityFont,'bakudai');
});
