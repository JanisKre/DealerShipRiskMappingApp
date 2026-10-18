// Applies the stored or system colour scheme before first paint to avoid a
// light flash in dark mode. Kept as an external file so the CSP needs no
// 'unsafe-inline' for scripts.
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem("theme");
  } catch (e) {
    // Storage can be blocked; fall back to the system preference.
  }
  var dark =
    theme === "dark" ||
    (theme !== "light" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();
