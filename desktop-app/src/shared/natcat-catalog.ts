import type { NatCatApiProvider } from "./types";

/**
 * Catalog of hail data sources shown in the settings.
 *
 * Coverage and access reflect the vendors' public product descriptions
 * (October 2026) and are informational only; the contracted product defines
 * what a connected endpoint actually returns. Commercial vendors are reached
 * through a customer endpoint that answers in the app's hazard API contract
 * (`docs/risk-model.md`), because their native schemas are only available to
 * contracted clients.
 */

export type NatCatSourceKind =
  /** Built in, always available (GDV hail zones + Open-Meteo screening). */
  | "builtin"
  /** Connectable through the app's hazard API contract. */
  | "api";

export interface NatCatCatalogEntry {
  id: "screening" | NatCatApiProvider;
  name: string;
  vendor: string;
  kind: NatCatSourceKind;
  license: "free" | "commercial";
  /** i18n key suffix under `settings.natCat.catalog.notes.*`. */
  noteKey: string;
  website?: string;
}

export const NAT_CAT_CATALOG: readonly NatCatCatalogEntry[] = [
  {
    id: "screening",
    name: "Open-Meteo Screening",
    vendor: "Open-Meteo + GDV hail zones",
    kind: "builtin",
    license: "free",
    noteKey: "screening",
  },
  {
    id: "swissre-catnet",
    name: "CatNet",
    vendor: "Swiss Re",
    kind: "api",
    license: "commercial",
    noteKey: "catnet",
  },
  {
    id: "munichre-lri",
    name: "Location Risk Intelligence",
    vendor: "Munich Re",
    kind: "api",
    license: "commercial",
    noteKey: "munichre",
    website:
      "https://www.munichre.com/rmp/en/products/location-risk-intelligence/natural-hazards-edition.null.html",
  },
  {
    id: "moodys-li",
    name: "Location Intelligence API",
    vendor: "Moody's RMS",
    kind: "api",
    license: "commercial",
    noteKey: "moodys",
  },
  {
    id: "verisk-li",
    name: "Location Intelligence API",
    vendor: "Verisk",
    kind: "api",
    license: "commercial",
    noteKey: "verisk",
  },
  {
    id: "custom-api",
    name: "Custom hazard API",
    vendor: "—",
    kind: "api",
    license: "commercial",
    noteKey: "custom",
  },
];

/** Catalog entry of an API provider (every API provider has one). */
export function catalogEntry(id: NatCatCatalogEntry["id"]): NatCatCatalogEntry {
  const entry = NAT_CAT_CATALOG.find((e) => e.id === id);
  if (!entry) throw new Error(`Unknown NatCat source: ${id}`);
  return entry;
}

/** Display label, e.g. "Swiss Re CatNet". */
export function sourceLabel(id: NatCatCatalogEntry["id"]): string {
  const entry = catalogEntry(id);
  return entry.vendor === "—" ? entry.name : `${entry.vendor} ${entry.name}`;
}
