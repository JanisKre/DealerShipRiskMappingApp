import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@renderer/components/ui/command";
import { ALL_NAV_ITEMS } from "@renderer/components/layout/navigation";
import { useTheme, type Theme } from "@renderer/components/theme/ThemeProvider";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Globale Cmd/Ctrl+K-Palette: Navigation + Design-Schnellaktionen. */
export function CommandPalette({
  open,
  onOpenChange,
}: CommandPaletteProps): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setTheme } = useTheme();

  const run = (fn: () => void): void => {
    onOpenChange(false);
    fn();
  };

  const themeOptions: Array<{ value: Theme; label: string; icon: typeof Sun }> =
    [
      { value: "light", label: t("settings.appearance.light"), icon: Sun },
      { value: "dark", label: t("settings.appearance.dark"), icon: Moon },
      {
        value: "system",
        label: t("settings.appearance.system"),
        icon: Monitor,
      },
    ];

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("command.title")}
      description={t("command.placeholder")}
    >
      <CommandInput placeholder={t("command.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("command.empty")}</CommandEmpty>
        <CommandGroup heading={t("command.navigation")}>
          {ALL_NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => (
            <CommandItem
              key={to}
              value={`${t(labelKey)} ${to}`}
              onSelect={() => run(() => navigate(to))}
            >
              <Icon />
              <span>{t(labelKey)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t("command.theme")}>
          {themeOptions.map(({ value, label, icon: Icon }) => (
            <CommandItem
              key={value}
              value={`${t("command.toggleTheme")} ${label}`}
              onSelect={() => run(() => setTheme(value))}
            >
              <Icon />
              <span>{label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
