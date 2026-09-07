import { STYLES } from "../js/styles.js";
import test from "node:test";
import assert from "node:assert/strict";
import { spectrum, draw, vinylPose, songTextOpacity } from "../js/visualizer.js";
import { frameTiming } from "../js/export.js";
import { readFileSync, existsSync } from "node:fs";
const buffer = (data) => ({ sampleRate: 48000, getChannelData: () => data });
test("FFT responds to audio and safely handles silence and end padding", () => {
  const silence = buffer(new Float32Array(4096));
  assert.ok(spectrum(silence, 0).every((x) => x === 0));
  assert.ok(spectrum(silence, 10).every((x) => x === 0));
  const sine = buffer(
    Float32Array.from({ length: 4096 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / 48000)),
  );
  const values = spectrum(sine, 0);
  assert.ok(Math.max(...values) > 0.5);
  assert.ok(values.every((x) => Number.isFinite(x) && x >= 0 && x <= 1));
});
test("all renderers work at both requested resolutions", () => {
  for (const height of [720, 1080])
    for (let style = 0; style < STYLES.length; style++) {
      let calls = 0;
      const context = new Proxy(
        {},
        {
          get: (_, key) =>
            key === "createRadialGradient"
              ? () => ({ addColorStop() {} })
              : (...args) => {
                  calls++;
                  for (const n of args) if (typeof n === "number") assert.ok(Number.isFinite(n));
                },
          set: () => true,
        },
      );
      draw({ width: (height * 16) / 9, height, getContext: () => context }, 0, null, null, {
        style,
        color: "#c5fa75",
        strength: 70,
        darkness: 45,
      });
      assert.ok(calls > 10);
    }
});
test("30 and 60 fps preserve fractional final duration", () => {
  for (const fps of [30, 60])
    for (const duration of [0.01, 1, 2.31]) {
      const count = Math.ceil(duration * fps),
        last = frameTiming(count - 1, fps, duration);
      assert.ok(last.duration > 0 && last.duration <= 1 / fps);
      assert.ok(Math.abs(last.timestamp + last.duration - duration) < 1e-9);
    }
});
test("every statically referenced UI element exists and public assets are local", () => {
  const html = readFileSync("index.html", "utf8"),
    app = readFileSync("js/app.js", "utf8");
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  const references = [...app.matchAll(/\$\(["']([^"']+)["']\)/g)];
  assert.ok(references.length > 20);
  for (const [, id] of references) assert.ok(ids.includes(id), id);
  for (const [, path] of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g))
    assert.ok(existsSync(path), path);
  assert.doesNotMatch(app, /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/);
});

test("new animations respond to audio and reproduce the same frame when seeking", () => {
  const silent = buffer(new Float32Array(96000));
  const tone = buffer(
    Float32Array.from({ length: 96000 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / 48000)),
  );
  function render(style, audio) {
    const commands = [];
    const context = new Proxy(
      {},
      {
        get: (_, key) =>
          key === "createRadialGradient"
            ? () => ({ addColorStop() {} })
            : (...args) => commands.push([key, ...args]),
        set: (_, key, value) => {
          commands.push([key, typeof value === "object" ? "gradient" : value]);
          return true;
        },
      },
    );
    draw({ width: 1280, height: 720, getContext: () => context }, 0.5, audio, null, {
      style,
      color: "#c5fa75",
      strength: 70,
      darkness: 45,
    });
    return commands;
  }
  for (let style = 6; style < STYLES.length; style++) {
    if (STYLES[style] === "無") continue;
    assert.deepEqual(render(style, tone), render(style, tone));
    assert.notDeepEqual(render(style, tone), render(style, silent));
  }
});

test('position transforms only animation after background and restores every frame', () => {
  for (const height of [720, 1080]) for (let style = 0; style < STYLES.length; style++) {
    const calls = [];
    const context = new Proxy({}, {
      get: (_, key) => key === 'createRadialGradient' ? () => ({addColorStop() {}}) : (...args) => calls.push([key, ...args]),
      set: () => true,
    });
    const width = height * 16 / 9;
    const canvas = {width, height, getContext:()=>context};
    const settings = {style, color:'#c5fa75', strength:70, darkness:45, positionX:25, positionY:-20};
    draw(canvas, .5, null, null, settings);
    const translation = calls.findIndex(call => call[0] === 'translate');
    assert.deepEqual(calls[translation], ['translate', width * .25, -height * .2]);
    assert.equal(calls[translation - 1][0], 'save');
    assert.ok(calls.slice(0, translation).some(call => call[0] === 'fillRect'));
    assert.equal(calls.at(-1)[0], 'restore');
  }
});

test('song title and credits are painted inside landscape and portrait frames in every style', () => {
  for (const [width, height] of [[1920,1080],[1080,1920]]) for (let style = 0; style < STYLES.length; style++) {
    const text = [];
    const c = new Proxy({}, {
      get: (_, key) => key === 'createRadialGradient' ? () => ({addColorStop(){}}) : key === 'fillText' ? (...args) => text.push(args) : () => {},
      set: () => true,
    });
    draw({width,height,getContext:()=>c}, 0, null, null, {style,color:'#c5fa75',strength:70,darkness:45,positionX:50,positionY:50,songTitle:'測試歌曲',lyricist:'甲',composer:'乙'});
    assert.deepEqual(text.slice(-3).map(line=>line[0]), ['測試歌曲','作詞：甲','作曲：乙']);
    for (const [,x,y] of text.slice(-3)) assert.ok(x > 0 && x < width && y > 0 && y < height);
  }
});

test("vinyl slides out before rotating clockwise at 33⅓ rpm", () => {
  assert.deepEqual(vinylPose(0), {slide: 0, angle: 0});
  assert.equal(vinylPose(1).slide, .5);
  assert.equal(vinylPose(1).angle, 0);
  assert.equal(vinylPose(2).slide, 1);
  assert.equal(vinylPose(2).angle, 0);
  assert.ok(vinylPose(4).angle > vinylPose(3).angle);
  assert.ok(Math.abs(vinylPose(3.8).angle - Math.PI * 2) < 1e-10);
  assert.deepEqual(vinylPose(5), vinylPose(5));
});

test("vinyl renders independent sleeve and circular record artwork", () => {
  const sleeve = {width: 800, height: 600}, record = {width: 600, height: 900};
  const commands = [];
  const context = new Proxy({}, {
    get: (_, key) => key === 'createRadialGradient' ? () => ({addColorStop() {}}) : (...args) => commands.push([key, ...args]),
    set: () => true,
  });
  draw({width:1280,height:720,getContext:()=>context}, 3, null, null, {
    style:18,color:'#c5fa75',strength:70,darkness:45,sleeve,record,
  });
  const images = commands.filter(([key]) => key === 'drawImage');
  assert.equal(images.length, 2);
  assert.equal(images[0][1], record);
  assert.equal(images[1][1], sleeve);
  assert.ok(commands.findIndex(([key]) => key === 'clip') < commands.findIndex(([key]) => key === 'drawImage'));
  assert.ok(commands.some(([key, angle]) => key === 'rotate' && angle > 0));
});

test("song text holds for chosen delay then fades over one second", () => {
  for (const delay of [1,5,15]) {
    assert.equal(songTextOpacity(0, delay), 1);
    assert.equal(songTextOpacity(delay, delay), 1);
    assert.equal(songTextOpacity(delay + .5, delay), .5);
    assert.equal(songTextOpacity(delay + 1, delay), 0);
    assert.equal(songTextOpacity(60, delay), 0);
  }
});

test("none style keeps background and song text without drawing animation", () => {
  const calls = [];
  const context = new Proxy({}, {
    get: (_, key) => (...args) => calls.push([key, ...args]),
    set: () => true,
  });
  draw({width:1280,height:720,getContext:()=>context}, 0, null, {width:100,height:100}, {
    style:STYLES.indexOf("無"),songTitle:"歌曲",color:"#ffffff",darkness:45,
  });
  assert.ok(calls.some(([key])=>key === "drawImage"));
  assert.ok(calls.some(([key,text])=>key === "fillText" && text === "歌曲"));
  assert.ok(!calls.some(([key])=>["stroke","arc","lineTo"].includes(key)));
});

test('subtitle placement and scale apply independently across all five anchors',()=>{
  for(const position of ['top','bottom','left','right','center']) for(const scale of [100,250]) {
    const calls=[]; const fonts=[];
    const context=new Proxy({}, {
      get:(_,key)=>key==='measureText'?()=>({width:100}):(...args)=>calls.push([key,...args]),
      set:(_,key,value)=>{if(key==='font') fonts.push(value);return true;},
    });
    draw({width:1280,height:720,getContext:()=>context},1,null,{width:100,height:100},{
      style:19, darkness:45, subtitles:{cues:[{start:0,end:3,text:'字幕'}]},originalBuffer:{duration:5},
      subtitlePosition:position,subtitleMargin:10,subtitleSize:scale,
    });
    const [,text,x,y]=calls.find(([key])=>key==='fillText');
    const size=720*.035*scale/100;
    const padding=size*.3;
    assert.ok(x>=0 && y>=0 && x<=1280 && y<=720);
    if(position==='left') assert.equal(x,128+padding);
    if(position==='right') assert.ok(Math.abs(x-(1152-padding))<1e-8);
    if(position==='top') assert.equal(y,72+padding+size*.7);
    if(position==='bottom') assert.ok(Math.abs(y-(648-padding-size*.7))<1e-8);
    if(position==='center') { assert.equal(x,640); assert.equal(y,360); }
    assert.equal(calls.filter(([key])=>key==='fillRect').length,2);
    assert.deepEqual(calls.find(([key])=>key==='strokeText').slice(1),calls.find(([key])=>key==='fillText').slice(1));
    assert.ok(fonts[0].includes(String(720*.035*scale/100)));
  }
});

test('vertical subtitles flow downward with subsequent columns to the left',()=>{
 const text=[];
 const context=new Proxy({}, {get:(_,key)=>key==='measureText'?()=>({width:100}):key==='fillText'?(...args)=>text.push(args):()=>{},set:()=>true});
 draw({width:1280,height:720,getContext:()=>context},1,null,{width:100,height:100},{style:19,darkness:45,subtitles:{cues:[{start:0,end:3,text:'甲乙\n丙丁'}]},originalBuffer:{duration:5},subtitleDirection:'vertical'});
 assert.deepEqual(text.map(line=>line[0]),['甲','乙','丙','丁']);
 assert.equal(text[0][1],text[1][1]);
 assert.ok(text[1][2]>text[0][2]);
 assert.ok(text[2][1]<text[0][1]);
 assert.equal(text[2][2],text[0][2]);
});

test('identity image is positioned independently, scales from 10–300%, and remains in frame',()=>{
 for(const position of [0,50,100]) for(const identityScale of [10,100,300]) {
  const calls=[]; const logo={width:400,height:200};
  const c=new Proxy({}, {get:(_,key)=>(...args)=>calls.push([key,...args]),set:()=>true});
  draw({width:1280,height:720,getContext:()=>c},0,null,{width:100,height:100},{style:19,darkness:45,identityType:'image',identityImage:logo,identityX:position,identityY:position,identityScale});
  const [,image,x,y,w,h]=calls.filter(([key])=>key==='drawImage').at(-1);
  assert.equal(image,logo);
  assert.ok(x>=0 && y>=0 && x+w<=1280 && y+h<=720);
  assert.equal(w/h,2);
  assert.ok(Math.abs(w-720*.16*identityScale/100)<1e-9);
 }
});
