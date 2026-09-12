// Wendet das gespeicherte Theme synchron beim Modul-Load an (vor dem ersten
// Render), damit es keinen Hell/Dunkel-Flash gibt. Quelle: localStorage['drm-theme'].
const stored = localStorage.getItem("drm-theme");
const theme =
  stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const isDark = theme === "dark" || (theme === "system" && prefersDark);
document.documentElement.classList.toggle("dark", isDark);
