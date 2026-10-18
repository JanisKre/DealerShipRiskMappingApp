import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type Localized, useLang } from "@/lib/i18n";

const LABEL: Localized = {
  en: "Toggle dark mode",
  de: "Dunkelmodus umschalten",
  fr: "Basculer le mode sombre",
};

// public/theme-init.js applies the initial class before first paint.
function toggleTheme(): void {
  const dark = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch {
    // Storage can be blocked; the choice then lasts for this page view.
  }
}

export function ThemeToggle(): React.JSX.Element {
  const label = LABEL[useLang()];
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={label}
    >
      <Sun className="dark:hidden" />
      <Moon className="hidden dark:block" />
    </Button>
  );
}
