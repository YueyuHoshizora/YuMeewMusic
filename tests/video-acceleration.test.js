import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseVideoAcceleration} from '../js/video-acceleration.js';
test('video export probes exact dimensions and prefers hardware',async()=>{
 const options={width:1080,height:1920,bitrate:8000000,framerate:60};
 assert.equal(await chooseVideoAcceleration(async(codec,config)=>{
   assert.equal(codec,'avc');assert.deepEqual(config,{...options,hardwareAcceleration:'prefer-hardware'});return true;
 },options),'prefer-hardware');
 assert.equal(await chooseVideoAcceleration(async(codec)=>codec==='vp9',options,undefined,'vp9'),'prefer-hardware');
});
test('unsupported or rejected hardware falls back to browser choice then software',async()=>{
 const modes=[];
 assert.equal(await chooseVideoAcceleration(async(_,config)=>{
  modes.push(config.hardwareAcceleration);
  if(modes.length===1) throw Error('unsupported');
  return config.hardwareAcceleration==='prefer-software';
 },{}),'prefer-software');
 assert.deepEqual(modes,['prefer-hardware','no-preference','prefer-software']);
 await assert.rejects(chooseVideoAcceleration(async()=>false,{}));
 await assert.rejects(chooseVideoAcceleration(async()=>true,{}, {aborted:true}),/取消/);
});
