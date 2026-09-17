// 共用播放器管理：確保畫面上同一時間只有一個「播放群組」在播放。
// 只要透過 registerAudioPlayer() 註冊，當任一個播放器開始播放時，其他已註冊、且不屬於
// 同一群組、正在播放中的播放器會自動暫停，不需要頁面自行協調。
//
// 大多數頁面每個 <audio> 都是各自獨立的播放器，不傳 group 即可，每次呼叫都會拿到一個
// 獨一無二的群組，等同「誰開始播誰就讓其他全部暫停」。少數頁面（例如人聲分離的人聲／
// 伴奏需要同步播放）可以傳同一個 group 字串，讓同組內的播放器彼此不會互相暫停，但開始
// 播放同組任何一個時，仍會暫停其他群組（例如原音試聽）正在播放的內容。
//
// 用法：
//   import { registerAudioPlayer } from "./audio-player.js";
//   registerAudioPlayer(audioElement);
//   registerAudioPlayer(vocalsAudio, { group: "separated" });
//   registerAudioPlayer(instrumentalAudio, { group: "separated" });

const registrations = new Map(); // audio -> group（任何值，用 === 比較；未指定則各自獨立）
let soloCounter = 0;

/**
 * 註冊一個 <audio> 元素納入「同時只能有一個群組在播放」的管理範圍。
 * 可在同一個元素上重複呼叫以更新群組，事件監聽只會綁定一次。
 * @param {HTMLAudioElement} audio
 * @param {{ group?: unknown }} [options] 同一個 group 內的播放器彼此不會互相暫停。
 */
export function registerAudioPlayer(audio, options = {}) {
  if (!audio) return;
  const group = Object.hasOwn(options, "group") ? options.group : Symbol(`solo-${soloCounter++}`);
  const alreadyRegistered = registrations.has(audio);
  registrations.set(audio, group);
  if (alreadyRegistered) return;
  audio.addEventListener("play", () => {
    const myGroup = registrations.get(audio);
    for (const [other, otherGroup] of registrations) {
      if (other === audio || otherGroup === myGroup) continue;
      if (!other.paused) other.pause();
    }
  });
  audio.addEventListener("emptied", () => {
    registrations.delete(audio);
  });
}

/**
 * 取消註冊，之後這個元素播放時不會再讓其他播放器暫停，也不會被其他播放器暫停。
 * @param {HTMLAudioElement} audio
 */
export function unregisterAudioPlayer(audio) {
  registrations.delete(audio);
}

function formatPlayerTime(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

/**
 * 簡易播放器：一個播放鍵 + 一條拖曳軸 + 時間顯示，搭配 css/audio-player.css 的
 * .audio-player / .audio-player-button / .audio-player-body / .audio-player-seek /
 * .audio-player-time 結構使用。會自動呼叫 registerAudioPlayer() 納入互斥播放管理。
 * @param {HTMLAudioElement} audio
 * @param {HTMLButtonElement} playButton
 * @param {HTMLInputElement} seekInput
 * @param {HTMLOutputElement} timeOutput
 * @param {{ group?: unknown }} [options] 傳給 registerAudioPlayer() 的分組設定。
 */
export function setupSimplePlayer(audio, playButton, seekInput, timeOutput, options = {}) {
  registerAudioPlayer(audio, options);
  let seeking = false;

  function renderTime() {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    timeOutput.textContent = `${formatPlayerTime(audio.currentTime)} / ${formatPlayerTime(duration)}`;
  }

  playButton.addEventListener("click", () => {
    if (!audio.src) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  });
  audio.addEventListener("play", () => {
    playButton.textContent = "⏸";
    playButton.setAttribute("aria-label", "暫停");
  });
  for (const eventName of ["pause", "ended"]) {
    audio.addEventListener(eventName, () => {
      playButton.textContent = "▶";
      playButton.setAttribute("aria-label", "播放");
    });
  }
  audio.addEventListener("loadedmetadata", () => {
    seekInput.max = String(Number.isFinite(audio.duration) ? audio.duration : 0);
    renderTime();
  });
  audio.addEventListener("timeupdate", () => {
    if (!seeking) seekInput.value = String(audio.currentTime);
    renderTime();
  });
  audio.addEventListener("emptied", () => {
    seekInput.value = "0";
    seekInput.max = "0";
    renderTime();
  });
  seekInput.addEventListener("input", () => {
    seeking = true;
    timeOutput.textContent = `${formatPlayerTime(Number(seekInput.value))} / ${formatPlayerTime(audio.duration || 0)}`;
  });
  seekInput.addEventListener("change", () => {
    audio.currentTime = Number(seekInput.value);
    seeking = false;
  });
}
