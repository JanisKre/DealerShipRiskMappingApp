/** Sections of the docs page, in order. Used for its table of contents and
 *  the teaser on the homepage. */
export const DOC_TOPICS = [
  {
    id: "quick-start",
    label: "Quick start",
    blurb: "From installation to the first exported portfolio in six steps.",
  },
  {
    id: "import-format",
    label: "Import format",
    blurb: "Supported files, recognised columns and a sample CSV.",
  },
  {
    id: "detection-model",
    label: "Detection model",
    blurb: "The vehicle detection model and what happens without it.",
  },
  {
    id: "hail-model",
    label: "How hail risk is scored",
    blurb: "Hail score sources, the EAL formula and its limitations.",
  },
  {
    id: "ai-memo",
    label: "AI memo",
    blurb: "Providers for memos and chat, and how API keys are stored.",
  },
  {
    id: "privacy",
    label: "Privacy & data",
    blurb: "What stays on your machine and which services are contacted.",
  },
  {
    id: "build",
    label: "Build from source",
    blurb: "Clone, rebuild native modules and create an installer.",
  },
  {
    id: "further-reading",
    label: "Further reading",
    blurb: "Architecture, risk model and policies in the repository.",
  },
] as const;

export type DocTopicId = (typeof DOC_TOPICS)[number]["id"];
