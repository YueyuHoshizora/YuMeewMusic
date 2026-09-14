const overlay = document.getElementById("feature-loading");

function finishLoading() {
  if (!overlay || overlay.classList.contains("is-complete")) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    overlay.classList.add("is-complete");
    document.body.removeAttribute("aria-busy");
    overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
    setTimeout(() => overlay.remove(), 500);
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", finishLoading, { once: true });
} else {
  finishLoading();
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || ["localhost", "127.0.0.1"].includes(location.hostname)) return;
  let updateApproved = false;
  let pendingWorker = null;

  const showUpdateNotice = worker => {
    pendingWorker = worker;
    if (document.getElementById("app-update-notice")) return;
    const notice = document.createElement("aside");
    notice.id = "app-update-notice";
    notice.className = "app-update-notice";
    notice.setAttribute("aria-labelledby", "app-update-title");
    notice.innerHTML = `
      <div><strong id="app-update-title">已有新版本</strong><span>更新後會重新載入頁面，已儲存的草稿會保留。</span></div>
      <div class="app-update-actions">
        <button class="app-update-later" type="button">稍後</button>
        <button class="app-update-now" type="button">立即更新</button>
      </div>`;
    notice.querySelector(".app-update-later").addEventListener("click", () => notice.remove());
    notice.querySelector(".app-update-now").addEventListener("click", event => {
      updateApproved = true;
      event.currentTarget.disabled = true;
      event.currentTarget.textContent = "正在更新…";
      pendingWorker?.postMessage({ type: "SKIP_WAITING" });
    });
    document.body.append(notice);
  };

  const reloadForUpdate = () => {
    if (updateApproved) location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", reloadForUpdate);
  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" });
    if (registration.waiting && navigator.serviceWorker.controller) showUpdateNotice(registration.waiting);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdateNotice(worker);
      });
    });
    await registration.update();
  } catch {
    navigator.serviceWorker.removeEventListener("controllerchange", reloadForUpdate);
  }
}

if (document.readyState === "complete") void registerServiceWorker();
else window.addEventListener("load", () => void registerServiceWorker(), { once: true });
