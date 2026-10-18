/**
 * Documentation pages, grouped and in reading order. Each slug is served from
 * its own HTML entry at docs/<slug>/index.html (see vite.config.ts), so keep
 * this list and those files in sync. Titles and blurbs are given per language
 * (en, de, fr); the HTML entries use the English ones. No imports:
 * vite.config.ts reads this file too.
 */
export const DOC_GROUPS = [
  {
    id: "getting-started",
    label: { en: "Getting started", de: "Erste Schritte", fr: "Premiers pas" },
    pages: [
      {
        slug: "installation",
        title: { en: "Installation", de: "Installation", fr: "Installation" },
        blurb: {
          en: "Installers for macOS and Windows, and how to open an unsigned build.",
          de: "Installer für macOS und Windows und wie sich ein unsignierter Build öffnen lässt.",
          fr: "Installateurs pour macOS et Windows, et comment ouvrir une version non signée.",
        },
      },
      {
        slug: "quick-start",
        title: { en: "Quick start", de: "Schnellstart", fr: "Démarrage rapide" },
        blurb: {
          en: "From installation to the first exported portfolio in six steps.",
          de: "In sechs Schritten von der Installation zum ersten exportierten Portfolio.",
          fr: "De l’installation au premier portefeuille exporté en six étapes.",
        },
      },
      {
        slug: "import-format",
        title: { en: "Import format", de: "Importformat", fr: "Format d’import" },
        blurb: {
          en: "Supported files, recognised columns and a sample CSV.",
          de: "Unterstützte Dateien, erkannte Spalten und eine Beispiel-CSV.",
          fr: "Fichiers pris en charge, colonnes reconnues et un exemple de CSV.",
        },
      },
    ],
  },
  {
    id: "how-it-works",
    label: { en: "How it works", de: "So funktioniert’s", fr: "Fonctionnement" },
    pages: [
      {
        slug: "detection-model",
        title: {
          en: "Vehicle detection",
          de: "Fahrzeugerkennung",
          fr: "Détection des véhicules",
        },
        blurb: {
          en: "The vehicle detection model and what happens without it.",
          de: "Das Modell zur Fahrzeugerkennung und was ohne es passiert.",
          fr: "Le modèle de détection des véhicules et ce qui se passe sans lui.",
        },
      },
      {
        slug: "hail-model",
        title: {
          en: "Hail risk scoring",
          de: "Hagelrisiko-Bewertung",
          fr: "Évaluation du risque de grêle",
        },
        blurb: {
          en: "Hail score sources, the EAL formula and its limitations.",
          de: "Quellen des Hagel-Scores, die EAL-Formel und ihre Grenzen.",
          fr: "Sources du score grêle, la formule de l’EAL et ses limites.",
        },
      },
      {
        slug: "ai-memo",
        title: { en: "AI memo & chat", de: "KI-Memo & Chat", fr: "Note IA & chat" },
        blurb: {
          en: "Providers for memos and chat, and how API keys are stored.",
          de: "Anbieter für Memos und Chat und wie API-Keys gespeichert werden.",
          fr: "Fournisseurs pour les notes et le chat, et stockage des clés API.",
        },
      },
      {
        slug: "privacy",
        title: {
          en: "Privacy & data",
          de: "Datenschutz & Daten",
          fr: "Confidentialité & données",
        },
        blurb: {
          en: "What stays on your machine and which services are contacted.",
          de: "Was auf deinem Rechner bleibt und welche Dienste kontaktiert werden.",
          fr: "Ce qui reste sur votre machine et quels services sont contactés.",
        },
      },
    ],
  },
  {
    id: "development",
    label: { en: "Development", de: "Entwicklung", fr: "Développement" },
    pages: [
      {
        slug: "build",
        title: {
          en: "Build from source",
          de: "Aus dem Quellcode bauen",
          fr: "Compiler depuis les sources",
        },
        blurb: {
          en: "Clone, rebuild native modules and create an installer.",
          de: "Klonen, native Module neu bauen und einen Installer erstellen.",
          fr: "Cloner, recompiler les modules natifs et créer un installateur.",
        },
      },
      {
        slug: "further-reading",
        title: {
          en: "Further reading",
          de: "Weiterführende Doku",
          fr: "Pour aller plus loin",
        },
        blurb: {
          en: "Architecture, risk model and policies in the repository.",
          de: "Architektur, Risikomodell und Richtlinien im Repository.",
          fr: "Architecture, modèle de risque et politiques dans le dépôt.",
        },
      },
    ],
  },
] as const;

export type DocGroup = (typeof DOC_GROUPS)[number];
export type DocPage = DocGroup["pages"][number];
export type DocSlug = DocPage["slug"];

/** All pages in reading order, each with the label of its group. */
export const DOC_PAGES: readonly (DocPage & { group: DocGroup["label"] })[] =
  DOC_GROUPS.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.label })));

export function isDocSlug(value: unknown): value is DocSlug {
  return DOC_PAGES.some((p) => p.slug === value);
}
