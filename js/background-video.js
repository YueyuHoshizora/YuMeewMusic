const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm"]);

export function isBackgroundVideo(file) {
  const extension = file?.name?.split(".").pop()?.toLowerCase();
  return VIDEO_TYPES.has(file?.type) || VIDEO_EXTENSIONS.has(extension);
}

export function loopingVideoTimestamp(time, duration) {
  const length = Number(duration);
  if (!(length > 0)) return 0;
  const value = Number(time) || 0;
  return ((value % length) + length) % length;
}

export async function createLoopingVideoDecoder(m, file) {
  if (!file) return null;
  const input = new m.Input({ source: new m.BlobSource(file), formats: m.ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw Error("背景影片的影像編碼無法解碼。");
    const duration = await track.computeDuration();
    if (!(duration > 0)) throw Error("背景影片沒有可播放的畫面。");
    return {
      input,
      duration,
      sink: new m.VideoSampleSink(track, { hardwareAcceleration: "no-preference" }),
    };
  } catch (error) {
    input.dispose();
    throw error;
  }
}

export async function getLoopingVideoSample(decoder, time) {
  if (!decoder) return null;
  return decoder.sink.getSample(loopingVideoTimestamp(time, decoder.duration));
}
