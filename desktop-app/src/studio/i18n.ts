import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import de from "./locales/de.json";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

/**
 * The studio's own i18next setup (de/en/fr), separate from the Electron
 * renderer's: the studio is its own page and bundle. Resources are bundled
 * statically. The language comes from the browser (remembered choice, else
 * navigator.language, else German) and keeps <html lang> in step.
 */
export const LANGUAGES = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
] as const;
export type Language = (typeof LANGUAGES)[number]["code"];

const STORAGE_KEY = "studio.language";

const isLanguage = (v: unknown): v is Language =>
  LANGUAGES.some((l) => l.code === v);

/** Remembered choice, else the browser's language, else German. */
export function initialLanguage(
  stored: string | null = readStored(),
  browser: readonly string[] = browserLanguages(),
): Language {
  if (isLanguage(stored)) return stored;
  for (const tag of browser) {
    const code = tag.toLowerCase().split("-")[0];
    if (isLanguage(code)) return code;
  }
  return "de";
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage unavailable (private window, blocked site data)
  }
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
}

export function setLanguage(lng: Language): void {
  void i18n.changeLanguage(lng);
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // the remembered language is a convenience only
  }
}

/** The current language as a BCP 47 tag for Intl. */
export const locale = (): string => i18n.resolvedLanguage ?? i18n.language;

void i18n.use(initReactI18next).init({
  resources: {
    de: { translation: de },
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: initialLanguage(),
  fallbackLng: "de",
  supportedLngs: LANGUAGES.map((l) => l.code),
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Screen readers pick the pronunciation from <html lang>.
function syncDocumentLanguage(lng: string): void {
  if (typeof document !== "undefined") document.documentElement.lang = lng;
}
syncDocumentLanguage(i18n.language);
i18n.on("languageChanged", syncDocumentLanguage);

export default i18n;
