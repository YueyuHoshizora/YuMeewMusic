// 共用播放器管理：確保畫面上同一時間只有一個 <audio> 在播放。
// 只要透過 registerAudioPlayer() 註冊，當任一個播放器開始播放時，
// 其他已註冊、且正在播放中的播放器會自動暫停，不需要頁面自行協調。
//
// 用法：
//   import { registerAudioPlayer } from "./audio-player.js";
//   registerAudioPlayer(audioElement);

const registeredAudios = new Set();

/**
 * 註冊一個 <audio> 元素納入「同時只能有一個在播放」的管理範圍。
 * 可在同一個元素上重複呼叫，不會重複註冊。
 * @param {HTMLAudioElement} audio
 */
export function registerAudioPlayer(audio) {
  if (!audio || registeredAudios.has(audio)) return;
  registeredAudios.add(audio);
  audio.addEventListener("play", () => {
    for (const other of registeredAudios) {
      if (other !== audio && !other.paused) other.pause();
    }
  });
  audio.addEventListener("emptied", () => {
    registeredAudios.delete(audio);
  });
}

/**
 * 取消註冊，之後這個元素播放時不會再讓其他播放器暫停。
 * @param {HTMLAudioElement} audio
 */
export function unregisterAudioPlayer(audio) {
  registeredAudios.delete(audio);
}
