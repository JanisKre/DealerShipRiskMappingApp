import { MapPin, Monitor, Moon, Sun } from "lucide-react";
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
import { useAppStore } from "@renderer/store/appStore";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Global Cmd/Ctrl+K palette: navigation, the portfolio's locations (opened
 * on the map) and appearance quick actions.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: CommandPaletteProps): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const dealerships = useAppStore((s) => s.dealerships);
  const select = useAppStore((s) => s.select);

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
        {dealerships.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t("dashboard.locations")}>
              {dealerships.map((d) => (
                <CommandItem
                  key={d.id}
                  // The id keeps two sites with the same name apart.
                  value={`${d.name} ${d.address ?? ""} ${d.id}`}
                  onSelect={() =>
                    run(() => {
                      select(d.id);
                      navigate("/");
                    })
                  }
                >
                  <MapPin />
                  <span className="min-w-0 truncate">{d.name}</span>
                  {d.address && (
                    <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">
                      {d.address}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
