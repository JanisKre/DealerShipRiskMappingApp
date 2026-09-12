import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import de from "./locales/de.json";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

/**
 * i18next setup (de/en/fr). Resources are bundled statically (no backend).
 * The language is set at startup from the app settings (see App.tsx);
 * `en` is the default and fallback.
 */
export const SUPPORTED_LANGUAGES = ["de", "en", "fr"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

void i18n.use(initReactI18next).init({
  resources: {
    de: { translation: de },
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
