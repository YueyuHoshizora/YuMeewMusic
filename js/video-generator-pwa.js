const installButton = document.getElementById("install-video-generator");
const brandLink = document.querySelector(".image-generator-header .brand");

const mobileUserAgent = navigator.userAgentData
  ? navigator.userAgentData.mobile
  : /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

let installPrompt = null;

if (standalone) {
  document.documentElement.classList.add("video-pwa-standalone");
  brandLink?.removeAttribute("href");
  brandLink?.removeAttribute("aria-label");
  brandLink?.setAttribute("aria-current", "page");
}

window.addEventListener("beforeinstallprompt", event => {
  if (mobileUserAgent || standalone || !installButton) return;
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});

installButton?.addEventListener("click", async () => {
  if (!installPrompt) return;
  installButton.disabled = true;
  await installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  installButton.hidden = outcome === "accepted";
  installButton.disabled = false;
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  if (installButton) installButton.hidden = true;
});
