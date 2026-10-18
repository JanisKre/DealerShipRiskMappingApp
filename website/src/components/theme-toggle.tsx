import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label="Toggle dark mode"
    >
      <Sun className="dark:hidden" />
      <Moon className="hidden dark:block" />
    </Button>
  );
}
