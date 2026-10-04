import type { NatCatApiProvider, Peril } from "./types";

/**
 * Catalog of natural-catastrophe data sources shown in the settings.
 *
 * Coverage and access reflect the vendors' public product descriptions
 * (October 2026) and are informational only; the contracted product defines
 * what a connected endpoint actually returns. Commercial vendors are reached
 * through a customer endpoint that answers in the app's hazard API contract
 * (`docs/risk-model.md`), because their native schemas are only available to
 * contracted clients.
 */

export type NatCatSourceKind =
  /** Built in, always available (Open-Meteo screening). */
  | "builtin"
  /** Per-location values from a file import. */
  | "import"
  /** Connectable through the app's hazard API contract. */
  | "api"
  /** Known source that is not integrated yet. */
  | "planned";

export interface NatCatCatalogEntry {
  id: "screening" | "zuers-geo" | NatCatApiProvider | "jrc-flood";
  name: string;
  vendor: string;
  kind: NatCatSourceKind;
  /** All perils, or the subset the source specializes in. */
  perils: readonly Peril[] | "all";
  /** Extra hazards outside the scored perils (shown as labels). */
  extraHazards?: readonly string[];
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
    perils: "all",
    license: "free",
    noteKey: "screening",
  },
  {
    id: "zuers-geo",
    name: "ZÜRS Geo",
    vendor: "GDV",
    kind: "import",
    perils: ["flood"],
    extraHazards: ["heavyRain"],
    license: "commercial",
    noteKey: "zuers",
  },
  {
    id: "swissre-catnet",
    name: "CatNet",
    vendor: "Swiss Re",
    kind: "api",
    perils: "all",
    license: "commercial",
    noteKey: "catnet",
  },
  {
    id: "munichre-lri",
    name: "Location Risk Intelligence",
    vendor: "Munich Re",
    kind: "api",
    perils: "all",
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
    perils: "all",
    license: "commercial",
    noteKey: "moodys",
  },
  {
    id: "verisk-li",
    name: "Location Intelligence API",
    vendor: "Verisk",
    kind: "api",
    perils: ["wind", "hail", "flood"],
    license: "commercial",
    noteKey: "verisk",
  },
  {
    id: "jba-flood",
    name: "Flood Maps",
    vendor: "JBA Risk Management",
    kind: "api",
    perils: ["flood"],
    extraHazards: ["heavyRain"],
    license: "commercial",
    noteKey: "jba",
    website: "https://jbarisk.com/products-services/maps-and-analytics",
  },
  {
    id: "fathom-flood",
    name: "Global Flood Map",
    vendor: "Fathom",
    kind: "api",
    perils: ["flood"],
    extraHazards: ["heavyRain"],
    license: "commercial",
    noteKey: "fathom",
  },
  {
    id: "custom-api",
    name: "Custom hazard API",
    vendor: "—",
    kind: "api",
    perils: "all",
    license: "commercial",
    noteKey: "custom",
  },
  {
    id: "jrc-flood",
    name: "European River Flood Hazard Maps",
    vendor: "JRC / Copernicus EMS",
    kind: "planned",
    perils: ["flood"],
    license: "free",
    noteKey: "jrc",
    website: "https://data.jrc.ec.europa.eu/collection/id-0054",
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

/** Whether a source covers a peril according to the catalog. */
export function coversPeril(
  id: NatCatCatalogEntry["id"],
  peril: Peril,
): boolean {
  const { perils } = catalogEntry(id);
  return perils === "all" || perils.includes(peril);
}
