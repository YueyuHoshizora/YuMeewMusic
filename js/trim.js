export function trimAudio(buffer, start, end, create = options => new AudioBuffer(options)) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > buffer.duration || end <= start)
    throw Error("請設定有效的裁剪範圍，結束時間必須大於開始時間。");
  const first = Math.floor(start * buffer.sampleRate);
  const last = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
  const result = create({length:last-first, sampleRate:buffer.sampleRate, numberOfChannels:buffer.numberOfChannels});
  for (let channel = 0; channel < buffer.numberOfChannels; channel++)
    result.getChannelData(channel).set(buffer.getChannelData(channel).subarray(first,last));
  return {buffer:result, start:first/buffer.sampleRate};
}
