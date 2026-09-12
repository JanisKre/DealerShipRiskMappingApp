/** Number/currency formatting, consistently de-DE (EUR figures use German grouping regardless of UI language). */

export function eur(
  n: number | undefined | null,
  maximumFractionDigits = 0,
): string {
  if (n == null) return "–";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits,
  }).format(n);
}

export function num(
  n: number | undefined | null,
  maximumFractionDigits = 0,
): string {
  if (n == null) return "–";
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits }).format(n);
}

export function pct(
  n: number | undefined | null,
  maximumFractionDigits = 0,
): string {
  if (n == null) return "–";
  return new Intl.NumberFormat("de-DE", {
    style: "percent",
    maximumFractionDigits,
  }).format(n);
}
