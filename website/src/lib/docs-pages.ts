/**
 * Documentation pages, grouped and in reading order. Each slug is served from
 * its own HTML entry at docs/<slug>/index.html (see vite.config.ts), so keep
 * this list and those files in sync. No imports: vite.config.ts reads it too.
 */
export const DOC_GROUPS = [
  {
    label: "Getting started",
    pages: [
      {
        slug: "installation",
        title: "Installation",
        blurb: "Installers for macOS and Windows, and how to open an unsigned build.",
      },
      {
        slug: "quick-start",
        title: "Quick start",
        blurb: "From installation to the first exported portfolio in six steps.",
      },
      {
        slug: "import-format",
        title: "Import format",
        blurb: "Supported files, recognised columns and a sample CSV.",
      },
    ],
  },
  {
    label: "How it works",
    pages: [
      {
        slug: "detection-model",
        title: "Vehicle detection",
        blurb: "The vehicle detection model and what happens without it.",
      },
      {
        slug: "hail-model",
        title: "Hail risk scoring",
        blurb: "Hail score sources, the EAL formula and its limitations.",
      },
      {
        slug: "ai-memo",
        title: "AI memo & chat",
        blurb: "Providers for memos and chat, and how API keys are stored.",
      },
      {
        slug: "privacy",
        title: "Privacy & data",
        blurb: "What stays on your machine and which services are contacted.",
      },
    ],
  },
  {
    label: "Development",
    pages: [
      {
        slug: "build",
        title: "Build from source",
        blurb: "Clone, rebuild native modules and create an installer.",
      },
      {
        slug: "further-reading",
        title: "Further reading",
        blurb: "Architecture, risk model and policies in the repository.",
      },
    ],
  },
] as const;

export type DocGroup = (typeof DOC_GROUPS)[number];
export type DocPage = DocGroup["pages"][number];
export type DocSlug = DocPage["slug"];

/** All pages in reading order, each with the label of its group. */
export const DOC_PAGES: readonly (DocPage & { group: string })[] =
  DOC_GROUPS.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.label })));

export function isDocSlug(value: unknown): value is DocSlug {
  return DOC_PAGES.some((p) => p.slug === value);
}
