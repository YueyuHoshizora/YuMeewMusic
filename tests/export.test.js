import test from "node:test";
import assert from "node:assert/strict";
import { encodeMedia, scalePcmSamples } from "../js/export.js";
import { FORMATS, getFormat, exportFilename } from "../js/formats.js";
import * as m from "../vendor/mediabunny.min.mjs";

// Only the Web Audio buffer wrapper is emulated; encoding uses the actual local WASM libraries.
class TestAudioBuffer {
  constructor({ length, numberOfChannels, sampleRate }) {
    Object.assign(this, { length, numberOfChannels, sampleRate, duration: length / sampleRate });
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel) {
    return this.data[channel];
  }
  copyToChannel(data, channel) {
    this.data[channel].set(data);
  }
  copyFromChannel(data, channel, start = 0) {
    data.set(this.data[channel].subarray(start, start + data.length));
  }
}

test("format definitions use real containers and appropriate file names", () => {
  for (const [key, format] of Object.entries(FORMATS)) {
    assert.equal(typeof m[format.container], "function");
    assert.equal(
      exportFilename("song.wav", key, "720", "60"),
      `song${format.video ? "-720p-60fps" : ""}.${key}`,
    );
  }
  assert.throws(() => getFormat("exe"));
  assert.equal(new m.MovOutputFormat().mimeType, "video/quicktime");
});

test("export volume scales PCM from 10–200 percent and clips safely", () => {
  assert.deepEqual([...scalePcmSamples(Float32Array.from([-.8, -.25, 0, .25, .8]), 200)], [-1, -.5, 0, .5, 1]);
  const quiet = scalePcmSamples(Float32Array.from([-.5, .5]), 10);
  assert.ok(Math.abs(quiet[0] + .05) < 1e-8);
  assert.ok(Math.abs(quiet[1] - .05) < 1e-8);
  assert.deepEqual([...scalePcmSamples(Float32Array.from([-.5, .5]), 1)], [...quiet]);
  assert.deepEqual([...scalePcmSamples(Float32Array.from([-.5, .5]))], [-.5, .5]);
});

test(
  "MP3 and FLAC encode actual stereo audio with correct containers and duration",
  { timeout: 30000 },
  async () => {
    const original = globalThis.AudioBuffer;
    globalThis.AudioBuffer = TestAudioBuffer;
    try {
      const buffer = new AudioBuffer({ length: 55200, numberOfChannels: 2, sampleRate: 48000 });
      for (let c = 0; c < 2; c++)
        for (let i = 0; i < buffer.length; i++)
          buffer.data[c][i] = 0.2 * Math.sin(((i * (440 + c * 220)) / 48000) * 2 * Math.PI);
      for (const format of ["mp3", "flac"]) {
        let progress = 0;
        const blob = await encodeMedia({
          format,
          buffer,
          signal: new AbortController().signal,
          onProgress: (value) => {
            progress = value;
          },
        });
        assert.equal(blob.type, FORMATS[format].mime);
        assert.ok(blob.size > 100);
        assert.equal(progress, 100);
        const data = new Uint8Array(await blob.arrayBuffer());
        if (format === "flac") assert.equal(new TextDecoder().decode(data.slice(0, 4)), "fLaC");
        const input = new m.Input({ source: new m.BufferSource(data), formats: m.ALL_FORMATS });
        try {
          const track = await input.getPrimaryAudioTrack();
          assert.equal(track.codec, format);
          assert.equal(await track.getNumberOfChannels(), 2);
          assert.ok(Math.abs((await input.computeDuration()) - buffer.duration) < 0.1);
          assert.equal((await input.getVideoTracks()).length, 0);
        } finally {
          input.dispose();
        }
      }
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        encodeMedia({ format: "mp3", buffer, signal: controller.signal, onProgress() {} }),
        /取消/,
      );
    } finally {
      if (original === undefined) delete globalThis.AudioBuffer;
      else globalThis.AudioBuffer = original;
    }
  },
);
