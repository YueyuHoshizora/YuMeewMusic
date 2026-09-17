import { applyTheme } from "./themes.js";
import { loadSettings } from "./settings.js";
import { clientIdentityHeaders } from "./client-identity.js";

const $ = id => document.getElementById(id);

applyTheme(loadSettings().mode, loadSettings().theme);

export const YOUTUBE_PROXY_URL = "https://model-proxy.yustellar.idv.tw/youtube/resolve";

const THUMB_LABELS = { default: "預設", medium: "中", high: "高", standard: "標準", maxres: "最高（若存在）" };

async function resolveYoutubeLink(url) {
  const response = await fetch(YOUTUBE_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...clientIdentityHeaders() },
    body: JSON.stringify({ url }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(result.error || result.message || `連結解析失敗（${response.status}）`);
  return result;
}

function renderTags(container, tags) {
  container.innerHTML = "";
  if (!tags?.length) {
    const empty = document.createElement("span");
    empty.className = "youtube-tags-empty";
    empty.textContent = "沒有 TAG";
    container.append(empty);
    return;
  }
  for (const tag of tags) {
    const chip = document.createElement("span");
    chip.textContent = tag;
    container.append(chip);
  }
}

async function copyText(text, button) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = "已複製";
    setTimeout(() => { button.textContent = original; }, 1500);
  } catch {
    // clipboard 權限被拒絕時，使用者仍可從唯讀欄位手動選取複製，這裡不用跳錯誤訊息。
  }
}

let videoBusy = false;

function setVideoError(message = "") {
  $("yt-video-error").textContent = message;
  $("yt-video-error").hidden = !message;
}

function setVideoBusy(value) {
  videoBusy = value;
  $("yt-video-url").disabled = value;
  $("yt-video-fetch").disabled = value;
}

async function fetchVideoInfo(event) {
  event.preventDefault();
  if (videoBusy) return;
  const url = $("yt-video-url").value.trim();
  setVideoError();
  $("yt-video-result").hidden = true;
  setVideoBusy(true);
  $("yt-video-fetch").textContent = "正在解析…";
  $("yt-video-status").textContent = "正在讀取公開影片頁面…";
  try {
    const result = await resolveYoutubeLink(url);
    if (result.type !== "video") throw Error("這個連結指向頻道，請貼到下方「頻道資訊」欄位。");
    $("yt-video-thumb").src = result.thumbnails?.high || result.thumbnails?.medium || result.thumbnails?.default || "";
    $("yt-video-title").value = result.title || "";
    $("yt-video-channel-id").value = result.channelId || "";
    const channelLink = $("yt-video-channel-link");
    if (result.channelId) {
      channelLink.href = result.channelUrl;
      channelLink.hidden = false;
    } else {
      channelLink.hidden = true;
    }
    const linksContainer = $("yt-video-thumb-links");
    linksContainer.innerHTML = "";
    for (const [key, label] of Object.entries(THUMB_LABELS)) {
      const href = result.thumbnails?.[key];
      if (!href) continue;
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = label;
      linksContainer.append(link);
    }
    renderTags($("yt-video-tags"), result.tags);
    $("yt-video-tags-text").value = (result.tags || []).join(", ");
    $("yt-video-result").hidden = false;
    $("yt-video-status").textContent = "已取得影片資訊。";
  } catch (error) {
    setVideoError(error?.message || "目前無法取得這部影片的資訊。");
    $("yt-video-status").textContent = "請確認連結可公開瀏覽後再試一次。";
  } finally {
    setVideoBusy(false);
    $("yt-video-fetch").textContent = "取得影片資訊";
  }
}

let channelBusy = false;

function setChannelError(message = "") {
  $("yt-channel-error").textContent = message;
  $("yt-channel-error").hidden = !message;
}

function setChannelBusy(value) {
  channelBusy = value;
  $("yt-channel-url").disabled = value;
  $("yt-channel-fetch").disabled = value;
}

async function fetchChannelInfo(event) {
  event.preventDefault();
  if (channelBusy) return;
  const url = $("yt-channel-url").value.trim();
  setChannelError();
  $("yt-channel-result").hidden = true;
  setChannelBusy(true);
  $("yt-channel-fetch").textContent = "正在解析…";
  $("yt-channel-status").textContent = "正在讀取公開頻道頁面…";
  try {
    const result = await resolveYoutubeLink(url);
    if (result.type !== "channel") throw Error("這個連結指向影片，請貼到上方「影片資訊」欄位。");
    $("yt-channel-name").value = result.channelName || "";
    $("yt-channel-id").value = result.channelId || "";
    renderTags($("yt-channel-tags"), result.tags);
    $("yt-channel-tags-text").value = (result.tags || []).join(", ");
    $("yt-channel-result").hidden = false;
    $("yt-channel-status").textContent = "已取得頻道資訊。";
  } catch (error) {
    setChannelError(error?.message || "目前無法取得這個頻道的資訊。");
    $("yt-channel-status").textContent = "請確認連結可公開瀏覽後再試一次。";
  } finally {
    setChannelBusy(false);
    $("yt-channel-fetch").textContent = "取得頻道資訊";
  }
}

$("yt-video-form").addEventListener("submit", fetchVideoInfo);
$("yt-channel-form").addEventListener("submit", fetchChannelInfo);

for (const button of document.querySelectorAll("[data-copy-target]")) {
  button.addEventListener("click", () => {
    const target = $(button.dataset.copyTarget);
    if (target) copyText(target.value, button);
  });
}

$("yt-video-tags-copy").addEventListener("click", () => copyText($("yt-video-tags-text").value, $("yt-video-tags-copy")));
$("yt-channel-tags-copy").addEventListener("click", () => copyText($("yt-channel-tags-text").value, $("yt-channel-tags-copy")));
