import type { TFunction } from "i18next";

/** Human-readable label for a raw boundary source code, falling back to it verbatim. */
export function boundarySourceLabel(
  t: TFunction,
  source: string | undefined,
): string {
  if (!source) return "–";
  return t(`dashboard.detailDialog.boundarySource.${source}`, {
    defaultValue: source,
  });
}
