import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LANGS, type Lang, type Localized, useLang, useSetLang } from "@/lib/i18n";

const LABEL: Localized = {
  en: "Language",
  de: "Sprache",
  fr: "Langue",
};

/** Ghost button showing the current language; a transparent native select on
 *  top handles the choice, so it works with keyboard, screen readers and on
 *  touch devices. */
export function LanguageSwitcher(): React.JSX.Element {
  const lang = useLang();
  const setLang = useSetLang();

  return (
    <Button variant="ghost" size="sm" className="relative gap-1.5 px-2" asChild>
      <span>
        <Globe />
        <span className="text-xs font-semibold uppercase">{lang}</span>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          aria-label={LABEL[lang]}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </span>
    </Button>
  );
}
