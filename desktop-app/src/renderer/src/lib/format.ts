import i18n from "i18next";

/**
 * Number and currency formatting in the UI language: "1.265.325.000 €" in
 * German, "€1,265,325,000" in English, "1 265 325 000 €" in French. Dates
 * elsewhere already follow `i18n.language`; numbers now match them. Falls
 * back to German before i18next has a language (tests, very early renders).
 */
export function uiLocale(): string {
  return i18n.language || "de";
}

/** The UI language as an export locale (files and save dialogs). */
export function exportLocale(): "de" | "en" | "fr" {
  const language = uiLocale().slice(0, 2);
  return language === "en" || language === "fr" ? language : "de";
}

export function eur(
  n: number | undefined | null,
  maximumFractionDigits = 0,
): string {
  if (n == null) return "–";
  return new Intl.NumberFormat(uiLocale(), {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits,
  }).format(n);
}

/**
 * Short form for chart labels: "338 Mio. €", "€338M". Older ICU builds
 * (Node 22) keep a trailing zero when rounding carries over (337.95 →
 * "338,0 Mio. €"), so an all-zero fraction is dropped explicitly to give the
 * same label on every runtime.
 */
export function eurCompact(n: number | undefined | null): string {
  if (n == null) return "–";
  const parts = new Intl.NumberFormat(uiLocale(), {
    style: "currency",
    currency: "EUR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).formatToParts(n);
  const zeroFraction = parts.some(
    (p) => p.type === "fraction" && /^0+$/u.test(p.value),
  );
  return parts
    .filter(
      (p) => !zeroFraction || (p.type !== "fraction" && p.type !== "decimal"),
    )
    .map((p) => p.value)
    .join("");
}

export function num(
  n: number | undefined | null,
  maximumFractionDigits = 0,
): string {
  if (n == null) return "–";
  return new Intl.NumberFormat(uiLocale(), { maximumFractionDigits }).format(n);
}

export function pct(
  n: number | undefined | null,
  maximumFractionDigits = 0,
): string {
  if (n == null) return "–";
  return new Intl.NumberFormat(uiLocale(), {
    style: "percent",
    maximumFractionDigits,
  }).format(n);
}

/**
 * A stored date ("2026-09-24" or an ISO timestamp) in the UI language
 * ("24.09.2026"). Text that is no date is returned as it is.
 */
export function isoDate(value: string | undefined | null): string {
  if (!value) return "–";
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value,
  );
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(uiLocale(), {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      });
}
