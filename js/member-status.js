const header = document.querySelector("header");

if (header) {
  const widget = document.createElement("a");
  widget.className = "member-widget";
  widget.href = "./account.html";
  widget.setAttribute("aria-label", "前往會員中心");
  widget.innerHTML = `<span class="member-widget-balance"><small>剩餘額度</small><strong>—</strong></span><span class="member-widget-avatar" aria-hidden="true">會</span>`;
  const widgetTarget = header.querySelector(".header-actions") || header;
  widgetTarget.append(widget);

  const balance = widget.querySelector("strong");
  const avatar = widget.querySelector(".member-widget-avatar");

  const showSignedOut = configured => {
    balance.textContent = configured ? "登入" : "未啟用";
    avatar.replaceChildren("會");
    avatar.removeAttribute("style");
  };

  const showSession = async (session, fetchAccount) => {
    if (!session?.user) {
      showSignedOut(true);
      return;
    }
    const metadata = session.user.user_metadata || {};
    const avatarUrl = metadata.avatar_url || metadata.picture;
    const fallback = String(metadata.full_name || metadata.name || session.user.email || "會").trim().charAt(0).toUpperCase();
    avatar.replaceChildren();
    avatar.removeAttribute("style");
    if (avatarUrl) {
      const image = new Image();
      image.src = avatarUrl;
      image.alt = "會員頭像";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => avatar.replaceChildren(fallback), { once: true });
      avatar.append(image);
    } else avatar.textContent = fallback;
    if (!fetchAccount) {
      balance.textContent = "—";
      return;
    }
    balance.textContent = "讀取中";
    try {
      const data = await fetchAccount(session, { ledger: false });
      balance.textContent = Number(data.balance || 0).toLocaleString("zh-TW");
    } catch {
      balance.textContent = "—";
    }
  };

  const loadMember = async () => {
    try {
      const [{ getCurrentSession, isSupabaseConfigured, onAuthStateChange }, { fetchMemberAccount, isMemberApiConfigured }] = await Promise.all([
        import("./auth.js"),
        import("./member-api.js"),
      ]);
      if (!isSupabaseConfigured()) {
        showSignedOut(false);
        return;
      }
      const { session } = await getCurrentSession();
      const loadSession = async nextSession => {
        if (!nextSession?.user) {
          showSignedOut(true);
          return;
        }
        await showSession(nextSession, isMemberApiConfigured() ? fetchMemberAccount : null);
      };
      await loadSession(session);
      onAuthStateChange(nextSession => void loadSession(nextSession));
    } catch {
      balance.textContent = "—";
    }
  };

  if ("requestIdleCallback" in window) requestIdleCallback(() => void loadMember(), { timeout: 1200 });
  else setTimeout(() => void loadMember(), 0);
}
