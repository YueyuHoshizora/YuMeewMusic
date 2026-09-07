import test from 'node:test';
import assert from 'node:assert/strict';
import {videoProfileConfig} from '../js/video-profile.js';
test('profile strings use correct profiles and levels for every export size and frame rate',()=>{
 for(const [profile,prefix] of [['baseline','42e0'],['main','4d00'],['high','6400']]) {
  for(const [width,height,fps,level] of [[1280,720,30,'1f'],[720,1280,60,'20'],[1920,1080,30,'28'],[1080,1920,60,'2a']])
   assert.equal(videoProfileConfig(profile,{width,height},fps).fullCodecString,`avc1.${prefix}${level}`);
 }
 assert.deepEqual(videoProfileConfig('auto',{},60),{});
 assert.throws(()=>videoProfileConfig('invalid',{width:1280,height:720},30));
});
