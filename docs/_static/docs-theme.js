(() => {
  const key = "coautoresearch.docs.theme";
  const root = document.documentElement;
  function apply(value) {
    const dark = value === "dark";
    root.dataset.docsTheme = dark ? "dark" : "light";
    document.querySelectorAll("[data-docs-theme-toggle]").forEach((button) => {
      button.textContent = dark ? "Light mode" : "Dark mode";
      button.setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} theme`);
    });
  }
  let saved = "light";
  try { saved = localStorage.getItem(key); } catch { /* Use light if storage is unavailable. */ }
  apply(saved);
  document.addEventListener("DOMContentLoaded", () => apply(root.dataset.docsTheme));
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-docs-theme-toggle]")) return;
    apply(root.dataset.docsTheme === "dark" ? "light" : "dark");
    try { localStorage.setItem(key, root.dataset.docsTheme); } catch { /* Keep the current page usable. */ }
  });
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
