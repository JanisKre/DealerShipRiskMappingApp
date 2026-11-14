import type {
  AnalyzedDealership,
  RiskParameters,
  Session,
} from "@shared/types";
import { RISK_MODEL_VERSION } from "@shared/constants";
import {
  displayedHailVehicleSource,
  isAreaEstimatedDetection,
  meanHailSeverityEur,
} from "@shared/risk-math";
import {
  ealCoverage,
  estimateReasons,
  estimatedExposure,
  hasEalBasis,
} from "@shared/estimates";

/**
 * Localised text and per-site provenance for the portfolio exports
 * (PDF, Excel, CSV, read-only HTML). Every export carries the screening
 * qualification, the placeholder status of λ/p/S, the EAL coverage, the
 * share of estimated exposure and the data sources (UW-11, UW-03).
 */

export type ExportLocale = "de" | "en" | "fr";

/** Where the vehicle figure of a site comes from, for the export columns. */
export type VehicleProvenance =
  "manual" | "detected" | "areaEstimate" | "estimated" | "assetValue" | "none";

export function vehicleProvenance(d: AnalyzedDealership): VehicleProvenance {
  if (d.detection?.manualVehicleCount != null) return "manual";
  if (isAreaEstimatedDetection(d.detection)) return "areaEstimate";
  if (!d.risk && !d.detection) return "none";
  return displayedHailVehicleSource(
    d.risk?.ealBreakdown?.hailDetail?.vehicleSource,
    d.detection,
  );
}

const LABELS = {
  de: {
    intl: "de-DE",
    csvSeparator: ";",
    reportTitle: "Hagel-Risikobericht",
    viewTitle: "Hagel-Risikoübersicht (schreibgeschützt)",
    portfolio: "Portfolio",
    created: "Erstellt",
    locations: "Standorte",
    totalExposure: "Gesamt-Exposure",
    totalEal: "Hagel-EAL / Jahr",
    elevated: (zone: number) => `In Hagelzone ≥ ${zone}`,
    clusters: "Kumulationen",
    ealCoverage: (withBasis: number, analyzed: number) =>
      `aus ${withBasis} von ${analyzed} Standorten mit Fahrzeugzahl`,
    estimatedShare: (share: number) => `davon ${share} % geschätzt`,
    noEal: "keine Fahrzeugzahl",
    yes: "ja",
    no: "nein",
    dialog: {
      report: "Bericht exportieren",
      view: "Schreibgeschützte Ansicht exportieren",
      portfolioExport: "Portfolio exportieren",
      portfolioImport: "Portfolio importieren",
      screenshot: "Kartenausschnitt speichern",
      portfolioFilter: "Dealership-Risk-Portfolio",
      htmlFilter: "HTML-Datei",
      pngFilter: "PNG-Bild",
    },
    vehicleSource: {
      manual: "manuell geprüft",
      detected: "Luftbild-Erkennung",
      areaEstimate: "Flächenschätzung (nicht in der EAL)",
      estimated: "geschätzt (Altbestand)",
      assetValue: "aus Asset-Wert (Altbestand)",
      none: "keine Fahrzeugzahl",
    } satisfies Record<VehicleProvenance, string>,
    columns: {
      name: "Name",
      address: "Adresse",
      lat: "Breite",
      lon: "Länge",
      assetValue: "Höchstentschädigung / Wert (EUR)",
      machineVehicles: "Fahrzeuge Erkennung/Schätzung",
      manualVehicles: "Fahrzeuge manuell",
      vehicles: "Fahrzeuge verwendet",
      vehicleSource: "Quelle Fahrzeugzahl",
      hailZone: "Hagelzone",
      hailZoneSource: "Quelle Hagelzone",
      exposure: "Exposure (EUR)",
      exposureEstimated: "Exposure geschätzt",
      eal: "Hagel-EAL (EUR/Jahr)",
      ealStatus: "Status Hagel-EAL",
      ealLow: "EAL Spanne niedrig (EUR)",
      ealHigh: "EAL Spanne hoch (EUR)",
      boundarySource: "Quelle Grundstücksgrenze",
      boundaryConfidence: "Konfidenz Grenze",
      confidence: "Konfidenz Ergebnis",
      modelVersion: "Modellversion",
      insured: "Bestandsgeschäft",
      salesPartner: "Vertriebspartner",
      subPortfolio: "Teilportfolio",
      group: "Gruppe",
      productLimit: "Produktlimit (EUR)",
      deductible: "Selbstbehalt (EUR)",
      clusterId: "Kumulation",
    },
    ealStatus: {
      ok: "berechnet",
      noCount: "keine Fahrzeugzahl",
      pending: "nicht analysiert",
    },
    methodTitle: "Methodik, Datenquellen und Einschränkungen",
    method: (m: MethodFacts) => [
      "Screening-Schätzung zur Unterstützung des Underwritings – keine Zeichnungs-, Tarif-, Engineering-, Rechts- oder Versicherungsentscheidung.",
      `Hagel-EAL = N × λ(Zone) × Σ p·S. N = auf dem Gelände gezählte Fahrzeuge (Erkennungsmodell oder manuell geprüft); ohne Fahrzeugzahl gibt es keine Hagel-EAL. Die Summe umfasst ${m.withBasis} von ${m.analyzed} analysierten Standorten.`,
      `λ, p und S sind Platzhalterwerte – Kalibrierung durch das Underwriting steht aus. Verwendet: λ Zone 1–6 = ${m.lambdas}; p klein/mittel/groß = ${m.shares}; S = ${m.severities} €; mittlerer Schaden je Fahrzeug und Ereignis ${m.meanSeverity} €.`,
      `Exposure = Fahrzeuge × Fahrzeugwert. ${m.estimatedShare} % des Exposures beruhen auf Schätzungen (Fahrzeugzahl aus der Grundstücksfläche oder geschätzte Kreisgrenze) und sind mit „geschätzt“ markiert.`,
      `Kumulationen: Standorte, die über Nachbarn ≤ ${m.radiusKm} km verkettet sind (Single Linkage); eine Kumulation kann deutlich größer als ${m.radiusKm} km sein.`,
      `Datenquellen: ${m.sources}.`,
      `Modellversion: ${m.modelVersions}.`,
    ],
  },
  en: {
    intl: "en-GB",
    csvSeparator: ",",
    reportTitle: "Hail Risk Report",
    viewTitle: "Hail Risk View (read-only)",
    portfolio: "Portfolio",
    created: "Created",
    locations: "Locations",
    totalExposure: "Total exposure",
    totalEal: "Hail EAL / year",
    elevated: (zone: number) => `In hail zone ≥ ${zone}`,
    clusters: "Accumulations",
    ealCoverage: (withBasis: number, analyzed: number) =>
      `from ${withBasis} of ${analyzed} sites with a vehicle count`,
    estimatedShare: (share: number) => `${share}% estimated`,
    noEal: "no vehicle count",
    yes: "yes",
    no: "no",
    dialog: {
      report: "Export Report",
      view: "Export Read-Only View",
      portfolioExport: "Export Portfolio",
      portfolioImport: "Import Portfolio",
      screenshot: "Save Map Screenshot",
      portfolioFilter: "Dealership Risk Portfolio",
      htmlFilter: "HTML File",
      pngFilter: "PNG Image",
    },
    vehicleSource: {
      manual: "manually reviewed",
      detected: "aerial detection",
      areaEstimate: "area estimate (not in EAL)",
      estimated: "estimated (legacy)",
      assetValue: "from asset value (legacy)",
      none: "no vehicle count",
    } satisfies Record<VehicleProvenance, string>,
    // Machine-readable keys: the English CSV header stays stable for
    // scripts that read it.
    columns: {
      name: "name",
      address: "address",
      lat: "lat",
      lon: "lon",
      assetValue: "assetValue",
      machineVehicles: "machineVehicleCount",
      manualVehicles: "manualVehicleCount",
      vehicles: "vehicleCount",
      vehicleSource: "vehicleSource",
      hailZone: "hailZone",
      hailZoneSource: "hailZoneSource",
      exposure: "exposureEur",
      exposureEstimated: "exposureEstimated",
      eal: "eal",
      ealStatus: "ealStatus",
      ealLow: "ealLowStockRange",
      ealHigh: "ealHighStockRange",
      boundarySource: "boundarySource",
      boundaryConfidence: "boundaryConfidence",
      confidence: "confidence",
      modelVersion: "modelVersion",
      insured: "insured",
      salesPartner: "salesPartner",
      subPortfolio: "subPortfolio",
      group: "group",
      productLimit: "productLimitEur",
      deductible: "deductibleEur",
      clusterId: "clusterId",
    },
    ealStatus: {
      ok: "computed",
      noCount: "no vehicle count",
      pending: "not analysed",
    },
    methodTitle: "Methodology, data sources and limitations",
    method: (m: MethodFacts) => [
      "Screening estimate in support of underwriting – not an underwriting, tariff, engineering, legal or insurance decision.",
      `Hail EAL = N × λ(zone) × Σ p·S. N = vehicles counted on the lot (detection model or manually reviewed); without a vehicle count there is no hail EAL. The total covers ${m.withBasis} of ${m.analyzed} analysed sites.`,
      `λ, p and S are placeholder values – calibration by underwriting is pending. Used: λ zone 1–6 = ${m.lambdas}; p small/medium/large = ${m.shares}; S = ${m.severities} EUR; mean loss per vehicle and event ${m.meanSeverity} EUR.`,
      `Exposure = vehicles × vehicle value. ${m.estimatedShare}% of the exposure rests on estimates (vehicle count from the lot area or an estimated circular boundary) and is flagged "estimated".`,
      `Accumulations: sites chained via neighbours ≤ ${m.radiusKm} km (single linkage); an accumulation can be much larger than ${m.radiusKm} km.`,
      `Data sources: ${m.sources}.`,
      `Model version: ${m.modelVersions}.`,
    ],
  },
  fr: {
    intl: "fr-FR",
    csvSeparator: ";",
    reportTitle: "Rapport de risque grêle",
    viewTitle: "Vue du risque grêle (lecture seule)",
    portfolio: "Portefeuille",
    created: "Créé le",
    locations: "Sites",
    totalExposure: "Exposition totale",
    totalEal: "EAL grêle / an",
    elevated: (zone: number) => `En zone de grêle ≥ ${zone}`,
    clusters: "Cumuls",
    ealCoverage: (withBasis: number, analyzed: number) =>
      `sur ${withBasis} des ${analyzed} sites avec nombre de véhicules`,
    estimatedShare: (share: number) => `dont ${share} % estimés`,
    noEal: "aucun nombre de véhicules",
    yes: "oui",
    no: "non",
    dialog: {
      report: "Exporter le rapport",
      view: "Exporter la vue en lecture seule",
      portfolioExport: "Exporter le portefeuille",
      portfolioImport: "Importer un portefeuille",
      screenshot: "Enregistrer la capture de carte",
      portfolioFilter: "Portefeuille Dealership Risk",
      htmlFilter: "Fichier HTML",
      pngFilter: "Image PNG",
    },
    vehicleSource: {
      manual: "vérifié manuellement",
      detected: "détection aérienne",
      areaEstimate: "estimation surface (hors EAL)",
      estimated: "estimé (ancien)",
      assetValue: "d’après la valeur (ancien)",
      none: "aucun nombre de véhicules",
    } satisfies Record<VehicleProvenance, string>,
    columns: {
      name: "Nom",
      address: "Adresse",
      lat: "Latitude",
      lon: "Longitude",
      assetValue: "Valeur / limite (EUR)",
      machineVehicles: "Véhicules détection/estimation",
      manualVehicles: "Véhicules manuels",
      vehicles: "Véhicules utilisés",
      vehicleSource: "Source nombre de véhicules",
      hailZone: "Zone de grêle",
      hailZoneSource: "Source zone de grêle",
      exposure: "Exposition (EUR)",
      exposureEstimated: "Exposition estimée",
      eal: "EAL grêle (EUR/an)",
      ealStatus: "Statut EAL grêle",
      ealLow: "EAL fourchette basse (EUR)",
      ealHigh: "EAL fourchette haute (EUR)",
      boundarySource: "Source limite du terrain",
      boundaryConfidence: "Confiance limite",
      confidence: "Confiance résultat",
      modelVersion: "Version du modèle",
      insured: "Portefeuille existant",
      salesPartner: "Partenaire commercial",
      subPortfolio: "Sous-portefeuille",
      group: "Groupe",
      productLimit: "Limite produit (EUR)",
      deductible: "Franchise (EUR)",
      clusterId: "Cumul",
    },
    ealStatus: {
      ok: "calculée",
      noCount: "aucun nombre de véhicules",
      pending: "non analysé",
    },
    methodTitle: "Méthodologie, sources et limites",
    method: (m: MethodFacts) => [
      "Estimation de criblage à l’appui de la souscription – pas une décision de souscription, tarifaire, technique, juridique ou d’assurance.",
      `EAL grêle = N × λ(zone) × Σ p·S. N = véhicules comptés sur le site (modèle de détection ou vérification manuelle) ; sans nombre de véhicules, pas d’EAL grêle. Le total couvre ${m.withBasis} des ${m.analyzed} sites analysés.`,
      `λ, p et S sont des valeurs provisoires – calibrage par la souscription en attente. Utilisé : λ zone 1–6 = ${m.lambdas} ; p petit/moyen/grand = ${m.shares} ; S = ${m.severities} EUR ; dommage moyen par véhicule et événement ${m.meanSeverity} EUR.`,
      `Exposition = véhicules × valeur du véhicule. ${m.estimatedShare} % de l’exposition reposent sur des estimations (nombre de véhicules d’après la surface ou limite circulaire estimée) et sont marqués « estimé ».`,
      `Cumuls : sites chaînés par voisins ≤ ${m.radiusKm} km (single linkage) ; un cumul peut dépasser largement ${m.radiusKm} km.`,
      `Sources de données : ${m.sources}.`,
      `Version du modèle : ${m.modelVersions}.`,
    ],
  },
} as const;

export type ExportLabels = (typeof LABELS)[ExportLocale];

export function exportLabels(locale: ExportLocale = "en"): ExportLabels {
  return LABELS[locale];
}

export interface MethodFacts {
  withBasis: number;
  analyzed: number;
  lambdas: string;
  shares: string;
  severities: string;
  meanSeverity: string;
  estimatedShare: number;
  radiusKm: number;
  sources: string;
  modelVersions: string;
}

/** The figures quoted in the methodology block, from the session itself. */
export function methodFacts(
  session: Session,
  parameters: RiskParameters,
  locale: ExportLocale,
): MethodFacts {
  const intl = LABELS[locale].intl;
  const n = (v: number, digits = 3): string =>
    v.toLocaleString(intl, { maximumFractionDigits: digits });
  const coverage = ealCoverage(session.dealerships);
  const sources = new Set<string>();
  const versions = new Set<string>();
  for (const d of session.dealerships) {
    for (const e of d.risk?.evidence ?? []) sources.add(e.source);
    if (d.risk?.modelVersion) versions.add(d.risk.modelVersion);
  }
  return {
    withBasis: coverage.withBasis,
    analyzed: coverage.analyzed,
    lambdas: ([1, 2, 3, 4, 5, 6] as const)
      .map((z) => n(parameters[`hailFrequencyZone${z}`]))
      .join(" / "),
    shares: [
      parameters.hailShareSmall,
      parameters.hailShareMedium,
      parameters.hailShareLarge,
    ]
      .map((v) => n(v, 2))
      .join(" / "),
    severities: [
      parameters.hailSeveritySmallEur,
      parameters.hailSeverityMediumEur,
      parameters.hailSeverityLargeEur,
    ]
      .map((v) => n(v, 0))
      .join(" / "),
    meanSeverity: n(meanHailSeverityEur(parameters), 0),
    estimatedShare: Math.round(
      estimatedExposure(session.dealerships).share * 100,
    ),
    radiusKm: parameters.accumulationRadiusKm,
    sources: sources.size ? [...sources].sort().join("; ") : "–",
    modelVersions: versions.size
      ? [...versions].sort().join(", ")
      : RISK_MODEL_VERSION,
  };
}

/** Per-site provenance shared by every export format. */
export interface SiteProvenance {
  vehicleSource: VehicleProvenance;
  exposureEstimated: boolean;
  ealStatus: "ok" | "noCount" | "pending";
  boundarySource?: string;
  boundaryConfidence?: number;
  confidence?: number;
  modelVersion?: string;
}

export function siteProvenance(d: AnalyzedDealership): SiteProvenance {
  return {
    vehicleSource: vehicleProvenance(d),
    exposureEstimated: estimateReasons(d).length > 0,
    ealStatus: !d.risk ? "pending" : hasEalBasis(d) ? "ok" : "noCount",
    boundarySource: d.boundary?.source,
    boundaryConfidence: d.boundary?.confidence,
    confidence: d.risk?.confidence,
    modelVersion: d.risk?.modelVersion,
  };
}
