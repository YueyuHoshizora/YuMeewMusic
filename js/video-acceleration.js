// Hardware preference is advisory; the browser ultimately selects the encoder.
export async function chooseVideoAcceleration(canEncodeVideo, options, signal, codec = 'avc') {
  for (const hardwareAcceleration of ['prefer-hardware', 'no-preference', 'prefer-software']) {
    if (signal?.aborted) throw Error('已取消匯出。');
    let supported = false;
    try { supported = await canEncodeVideo(codec, {...options, hardwareAcceleration}); }
    catch { /* Some browsers reject hardware preference probes. Try the next mode. */ }
    if (signal?.aborted) throw Error('已取消匯出。');
    if (supported) return hardwareAcceleration;
  }
  throw Error('此瀏覽器無法使用目前設定編碼影片。');
}
