import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSubtitles,subtitleAt} from '../js/subtitles.js';
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
test('TXT distributes lines across original duration and malformed timed files fail',()=>{
 const data=parseSubtitles('甲\n乙','txt');
 assert.equal(subtitleAt(data,0,10),'甲');
 assert.equal(subtitleAt(data,5,10),'乙');
 assert.equal(subtitleAt(data,10,10),'');
 assert.throws(()=>parseSubtitles('invalid','srt'));
 assert.throws(()=>parseSubtitles('','txt'));
});
