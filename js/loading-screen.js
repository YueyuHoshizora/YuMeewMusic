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

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || ["localhost", "127.0.0.1"].includes(location.hostname)) return;
  void navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}

if (document.readyState === "complete") registerServiceWorker();
else window.addEventListener("load", registerServiceWorker, { once: true });
