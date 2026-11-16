export function bindPlayerExperience(document, session) {
  const profile = document.getElementById("player-profile");
  const guestActions = document.getElementById("guest-actions");
  const memberActions = document.getElementById("member-actions");
  const welcome = document.getElementById("player-welcome");
  const menuButton = document.getElementById("mobile-menu-toggle");
  const mobileMenu = document.getElementById("mobile-navigation");

  function render(user) {
    const nickname = typeof user?.nickname === "string" ? user.nickname.trim() : "";
    const authenticated = Boolean(nickname);
    profile.hidden = !authenticated;
    guestActions.hidden = authenticated;
    memberActions.hidden = !authenticated;
    if (authenticated) welcome.textContent = `С возвращением, ${nickname}`;
    document.body.dataset.accountState = authenticated ? "authenticated" : "guest";
  }

  function closeMenu() {
    mobileMenu.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
  }

  menuButton.addEventListener("click", () => {
    const open = mobileMenu.hidden;
    mobileMenu.hidden = !open;
    menuButton.setAttribute("aria-expanded", String(open));
    if (open) mobileMenu.querySelector("a")?.focus();
  });
  mobileMenu.querySelectorAll("a").forEach(link => link.addEventListener("click", closeMenu));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !mobileMenu.hidden) {
      closeMenu();
      menuButton.focus();
    }
  });
  document.defaultView?.addEventListener("hashchange", () => {
    if (!mobileMenu.hidden) closeMenu();
  });

  session.onSessionChange(render);
  return { render, closeMenu };
}
