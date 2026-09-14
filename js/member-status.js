const header = document.querySelector("header");

if (header) {
  const widget = document.createElement("a");
  widget.className = "member-widget";
  widget.href = "./account.html";
  widget.setAttribute("aria-label", "前往會員中心");
  widget.innerHTML = `<span class="member-widget-balance"><small>剩餘額度</small><strong>—</strong></span><span class="member-widget-avatar" aria-hidden="true">會</span>`;
  header.append(widget);

  const balance = widget.querySelector("strong");
  const avatar = widget.querySelector(".member-widget-avatar");

  const showSignedOut = configured => {
    balance.textContent = configured ? "登入" : "未啟用";
    avatar.replaceChildren("會");
    avatar.removeAttribute("style");
  };

  const showSession = async (session, authClient) => {
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
    balance.textContent = "讀取中";
    const { data, error } = await authClient
      .from("credit_accounts")
      .select("balance")
      .eq("user_id", session.user.id)
      .maybeSingle();
    balance.textContent = error ? "—" : Number(data?.balance || 0).toLocaleString("zh-TW");
  };

  const loadMember = async () => {
    try {
      const { getAuthClient, getCurrentSession, isSupabaseConfigured, onAuthStateChange } = await import("./auth.js");
      if (!isSupabaseConfigured()) {
        showSignedOut(false);
        return;
      }
      const authClient = getAuthClient();
      const { session } = await getCurrentSession();
      await showSession(session, authClient);
      onAuthStateChange(nextSession => void showSession(nextSession, authClient));
    } catch {
      balance.textContent = "—";
    }
  };

  if ("requestIdleCallback" in window) requestIdleCallback(() => void loadMember(), { timeout: 1200 });
  else setTimeout(() => void loadMember(), 0);
}
