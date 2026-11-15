import { type TFunction } from "i18next";
import type { BoundaryResult, RiskParameters } from "@shared/types";
import { boundaryReviewReasons } from "@shared/boundary-review";
import { boundarySourceLabel } from "@renderer/lib/boundarySource";

/** Human-readable label for a raw boundary role code, falling back to it verbatim. */
export function boundaryRoleLabel(
  t: TFunction,
  role: string | undefined,
): string {
  if (!role) return "";
  return t(`dashboard.detailDialog.boundaryRole.${role}`, {
    defaultValue: role,
  });
}

/** Display name of a boundary candidate, from its provider rather than the engine's English label. */
export function candidateLabel(
  t: TFunction,
  candidate: { provider?: string; source: string; label?: string },
): string {
  const key: Record<string, string> = {
    "alkis-vehicle-parcels": "dashboard.detailDialog.candidate.vehicleParcels",
    "vehicle-hull": "dashboard.detailDialog.candidate.vehicleHull",
    "alkis-parcel": "dashboard.detailDialog.candidate.parcel",
    "osm-dealer-area": "dashboard.detailDialog.candidate.osmDealerArea",
    synthetic: "dashboard.detailDialog.candidate.synthetic",
  };
  const k = candidate.provider ? key[candidate.provider] : undefined;
  if (!k) {
    // Labels written by the boundary engine in English (stored per site).
    const parcels = candidate.label?.match(
      /^ALKIS parcel(?: \+ (\d+) with vehicles)?$/,
    );
    if (parcels)
      return parcels[1]
        ? t("dashboard.detailDialog.candidate.parcelPlusVehicles", {
            count: Number(parcels[1]),
          })
        : t("dashboard.detailDialog.candidate.parcel");
    return candidate.label ?? boundarySourceLabel(t, candidate.source);
  }
  const name = t(k);
  return candidate.provider === "osm-dealer-area" && candidate.label
    ? `${name} · ${candidate.label}`
    : name;
}

/**
 * The boundary with the actions a reviewer needs: confirm it, edit it on the
 * map, or take one of the other candidates the cascade already computed.
 * Technical detail (role, agreement, engine, stage reasons) sits behind a
 * disclosure.
 */
/** "Check because: …" with the reasons the review rule found, or "". */
export function boundaryReviewText(
  t: TFunction,
  boundary: BoundaryResult,
  parameters: RiskParameters,
): string {
  const reasons = boundaryReviewReasons(boundary, parameters);
  if (reasons.length === 0) return "";
  return t("dashboard.detailDialog.boundaryReviewBecause", {
    reasons: reasons
      .map((reason) =>
        t(`dashboard.detailDialog.boundaryReviewReason.${reason}`),
      )
      .join("; "),
  });
}
