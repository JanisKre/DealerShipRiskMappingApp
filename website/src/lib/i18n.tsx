import { createContext, useContext, useEffect, useState } from "react";

export const LANGS = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
] as const;

export type Lang = (typeof LANGS)[number]["code"];

/** A value per language; components keep their own copy next to the markup. */
export type Localized<T = string> = Record<Lang, T>;

const STORAGE_KEY = "lang";

function isLang(value: unknown): value is Lang {
  return LANGS.some((l) => l.code === value);
}

/** Stored choice first, then the browser languages, then English. */
function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    // Storage can be blocked; fall back to the browser languages.
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = tag.slice(0, 2).toLowerCase();
    if (isLang(code)) return code;
  }
  return "en";
}

const LangContext = createContext<{ lang: Lang; setLang: (lang: Lang) => void }>({
  lang: "en",
  setLang: () => {},
});

export function LangProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  function setLang(next: Lang): void {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be blocked; the choice then lasts for this page view.
    }
  }

  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext).lang;
}

export function useSetLang(): (lang: Lang) => void {
  return useContext(LangContext).setLang;
}
