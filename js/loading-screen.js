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
  const controlled = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  const reloadForUpdate = () => {
    if (!controlled || reloading) return;
    reloading = true;
    location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", reloadForUpdate, { once: true });
  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" });
    await registration.update();
  } catch {
    navigator.serviceWorker.removeEventListener("controllerchange", reloadForUpdate);
  }
}

if (document.readyState === "complete") void registerServiceWorker();
else window.addEventListener("load", () => void registerServiceWorker(), { once: true });
