import test from 'node:test';
import assert from 'node:assert/strict';
import {formatSubtitleTime,parseSubtitleTime,parseSubtitles,serializeSubtitles,subtitleAt} from '../js/subtitles.js';
test('SRT timing and multiline text survive parsing, with exclusive end time',()=>{
  const data=parseSubtitles('1\r\n00:00:01,500 --> 00:00:03,000\r\n<b>你好</b>\r\n世界','srt');
  assert.equal(subtitleAt(data,1,10),'');
  assert.equal(subtitleAt(data,1.5,10),'你好\n世界');
  assert.equal(subtitleAt(data,3,10),'');
});
test('ASS handles commas, line breaks and strips style overrides',()=>{
 const data=parseSubtitles('[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:02.00,0:00:05.00,Default,,0,0,0,,{\\b1}Hello, world\\N字幕','ass');
 assert.equal(subtitleAt(data,3,10),'Hello, world\n字幕');
});
test('TXT respects timestamps, next-cue boundaries, blank clearing and repeated timestamps',()=>{
 const data=parseSubtitles('[00:02.50]甲\n[00:05][00:08]乙\n[00:09]','txt');
 assert.equal(subtitleAt(data,0,10),'');
 assert.equal(subtitleAt(data,2.5,10),'甲');
 assert.equal(subtitleAt(data,5,10),'乙');
 assert.equal(subtitleAt(data,9,10),'');
 assert.throws(()=>parseSubtitles('甲\n乙','txt'));
 assert.throws(()=>parseSubtitles('[00:99]錯誤','txt'));
 assert.throws(()=>parseSubtitles('invalid','srt'));
});
test('TXT supports SRT ranges and plain timestamp lines',()=>{
 const srt=parseSubtitles('1\n00:00:02,000 --> 00:00:04,000\n字幕','txt');
 assert.equal(subtitleAt(srt,3,10),'字幕');
 assert.equal(subtitleAt(srt,4,10),'');
 const plain=parseSubtitles('00:02 第一行\n00:04.50 第二行','txt');
 assert.equal(subtitleAt(plain,4.5,10),'第二行');
 assert.equal(subtitleAt(plain,10,10),'');
});

test('typewriter follows cue timestamps and retains complete Unicode characters',()=>{
 const data={cues:[{start:2,end:6,text:'甲乙丙丁'}]};
 assert.equal(subtitleAt(data,2,10,true),'甲');
 assert.equal(subtitleAt(data,4,10,true),'甲乙丙');
 assert.equal(subtitleAt(data,5.9,10,true),'甲乙丙丁');
 assert.equal(subtitleAt(data,6,10,true),'');
 assert.equal(subtitleAt(data,2,10,false),'甲乙丙丁');
 const emoji={cues:[{start:0,end:Infinity,text:'👨‍👩‍👧‍👦好'}]};
 assert.equal(subtitleAt(emoji,0,4,true),'👨‍👩‍👧‍👦');
 assert.equal(subtitleAt(emoji,3,4,true),'👨‍👩‍👧‍👦好');
});

test('edited subtitles serialize as standard SRT and can be parsed again',()=>{
 const source={cues:[
  {start:65.25,end:68.5,text:'第二行\n字幕'},
  {start:1.005,end:2,text:'第一行'},
 ]};
 const text=serializeSubtitles(source);
 assert.match(text,/1\n00:00:01,005 --> 00:00:02,000\n第一行/);
 assert.match(text,/2\n00:01:05,250 --> 00:01:08,500\n第二行\n字幕/);
 assert.deepEqual(parseSubtitles(text,'srt').cues,source.cues.toSorted((a,b)=>a.start-b.start));
 assert.equal(formatSubtitleTime(65.25),'01:05.250');
 assert.equal(parseSubtitleTime('01:05.250'),65.25);
});
