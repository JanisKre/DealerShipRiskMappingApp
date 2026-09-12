import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { useTheme, type Theme } from "./ThemeProvider";

/** Theme-Umschalter (light / dark / system) als Icon-Dropdown. */
export function ThemeToggle(): React.JSX.Element {
  const { t } = useTranslation();
  const { theme, resolvedTheme, setTheme } = useTheme();

  const options: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
    { value: "light", label: t("settings.appearance.light"), icon: Sun },
    { value: "dark", label: t("settings.appearance.dark"), icon: Moon },
    { value: "system", label: t("settings.appearance.system"), icon: Monitor },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("settings.appearance.title")}
        >
          {resolvedTheme === "dark" ? <Moon /> : <Sun />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setTheme(value)}
            className={
              theme === value ? "bg-accent text-accent-foreground" : ""
            }
          >
            <Icon />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
