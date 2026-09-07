import test from 'node:test';
import assert from 'node:assert/strict';
import {trimAudio} from '../js/trim.js';
test('trim copies exact samples from every channel without changing original audio', () => {
  const channels = [Float32Array.from([0,1,2,3,4,5,6,7]), Float32Array.from([8,9,10,11,12,13,14,15])];
  const source = {duration:2,length:8,sampleRate:4,numberOfChannels:2,getChannelData:i=>channels[i]};
  const create = options => {
    const data = Array.from({length:options.numberOfChannels},()=>new Float32Array(options.length));
    return {...options,duration:options.length/options.sampleRate,getChannelData:i=>data[i]};
  };
  const result = trimAudio(source,.5,1.5,create);
  assert.equal(result.start,.5);
  assert.equal(result.buffer.duration,1);
  assert.deepEqual([...result.buffer.getChannelData(0)],[2,3,4,5]);
  assert.deepEqual([...result.buffer.getChannelData(1)],[10,11,12,13]);
  result.buffer.getChannelData(0)[0]=99;
  assert.equal(channels[0][2],2);
  for(const [start,end] of [[1,1],[1,.5],[-1,1],[0,3],[NaN,1]]) assert.throws(()=>trimAudio(source,start,end,create));
});
