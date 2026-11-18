import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Pencil, RotateCcw, TriangleAlert } from "lucide-react";
import area from "@turf/area";
import type {
  AnalyzedDealership,
  BoundaryCandidate,
  BoundaryResult,
} from "@shared/types";
import { asPolygon, outerRings } from "@shared/boundary-geometry-utils";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { useAppStore } from "@renderer/store/appStore";
import { num, pct } from "@renderer/lib/format";
import { Disclosure, Metric } from "./shared";
import { candidateLabel, boundaryReviewText } from "./boundaryText";

/**
 * Drops every extra `MultiPolygon` part except the largest, producing a
 * plain `Polygon` (docs/boundary-improvement-plan.de.md P6 — a reviewer
 * rejecting a separately-confirmed component, P3, should not have to
 * redraw the whole site by hand).
 */
function withoutExtraComponents(boundary: BoundaryResult): BoundaryResult {
  if (boundary.polygon.type !== "MultiPolygon") return boundary;
  const rings = outerRings(boundary.polygon);
  const largest = rings.reduce((best, ring) =>
    Math.abs(area(asPolygon(ring) as never)) >
    Math.abs(area(asPolygon(best) as never))
      ? ring
      : best,
  );
  const polygon = asPolygon(largest);
  let areaSqm = boundary.areaSqm;
  try {
    areaSqm = area(polygon as never);
  } catch {
    // Area stays unchanged on error.
  }
  return { ...boundary, source: "manual", polygon, areaSqm };
}

/**
 * The vehicle outline is only a fallback for sites without a usable cadastre.
 * Next to parcels that already hold most of the vehicles (full stage-1
 * confidence) it is always the worse choice — it follows parked cars into the
 * street — so it is not offered there.
 */
function weakerVehicleOutline(
  candidate: BoundaryCandidate,
  current: BoundaryResult,
): boolean {
  return (
    candidate.provider === "vehicle-hull" &&
    current.provider === "alkis-vehicle-parcels" &&
    current.confidence >= 0.75
  );
}

function sameGeometry(a: BoundaryCandidate, b: BoundaryResult): boolean {
  return (
    a.provider === b.provider &&
    Math.abs(a.areaSqm - b.areaSqm) < 1 &&
    a.source === b.source
  );
}

export function BoundaryPanel({
  d,
  onEditOnMap,
  inReview = false,
}: {
  d: AnalyzedDealership;
  onEditOnMap: () => void;
  /**
   * The review strip above already says why the boundary is open and
   * confirms it; the panel then leaves both out instead of repeating them.
   */
  inReview?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const parameters = useAppStore((s) => s.parameters);
  const confirmBoundary = useAppStore((s) => s.confirmBoundary);
  const updateBoundary = useAppStore((s) => s.updateBoundaryAndRescore);
  const saveBoundaryEdit = useAppStore((s) => s.saveBoundaryEdit);
  const undoBoundaryEdit = useAppStore((s) => s.undoBoundaryEdit);
  const revertBoundaryToDefault = useAppStore((s) => s.revertBoundaryToDefault);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<BoundaryCandidate | null>(null);
  const boundary = d.boundary;
  if (!boundary) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("dashboard.detailDialog.boundaryNone")}
      </p>
    );
  }
  const confirmed =
    boundary.source === "manual" || boundary.confirmedAt != null;
  const others = (boundary.candidates ?? []).filter(
    (candidate) =>
      !sameGeometry(candidate, boundary) &&
      !weakerVehicleOutline(candidate, boundary),
  );

  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function adopt(candidate: BoundaryCandidate): Promise<void> {
    // Choosing a computed candidate is a reviewer's decision: it counts as
    // confirmed, and the vehicles are recounted inside it.
    return run(async () => {
      await updateBoundary(d.id, {
        ...boundary!,
        source: candidate.source,
        role: candidate.role,
        provider: candidate.provider,
        polygon: candidate.polygon,
        areaSqm: candidate.areaSqm,
        confidence: candidate.confidence,
        label: candidate.label,
        evidence: candidate.evidence ?? boundary!.evidence,
        quality: {
          ...(candidate.quality ?? boundary!.quality ?? { reasons: [] }),
          reasons: [
            `chosen manually from the boundary suggestions (${candidate.provider ?? candidate.source})`,
          ],
        } as BoundaryResult["quality"],
        reviewRequired: false,
        confirmedAt: new Date().toISOString(),
      });
      await saveBoundaryEdit(d.id);
      toast.success(
        t("dashboard.detailDialog.boundaryAdopted", {
          label: candidateLabel(t, candidate),
        }),
        {
          action: {
            label: t("map.page.undoBoundaryEdit"),
            onClick: () =>
              void run(async () => {
                await undoBoundaryEdit(d.id);
                await saveBoundaryEdit(d.id);
              }),
          },
        },
      );
    });
  }

  function restoreOriginal(): Promise<void> {
    return run(async () => {
      await revertBoundaryToDefault(d.id);
      await saveBoundaryEdit(d.id);
    });
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">
          {t("dashboard.detailDialog.boundaryTitle")}
        </h4>
        {boundary.reviewRequired ? (
          <Badge variant="warning">
            {t("dashboard.detailDialog.boundaryReviewLabel")}
          </Badge>
        ) : confirmed ? (
          <Badge variant="outline" className="gap-1">
            <Check className="size-3" />
            {t("dashboard.detailDialog.boundaryStatusConfirmed")}
          </Badge>
        ) : null}
      </div>
      {boundary.reviewRequired && !inReview && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert
            aria-hidden
            className="mt-0.5 size-3.5 shrink-0 text-warning-foreground"
          />
          {boundaryReviewText(t, boundary, parameters)}
        </p>
      )}
      <p className="text-muted-foreground">
        {candidateLabel(t, boundary)} · {num(boundary.areaSqm)} m² ·{" "}
        {t("dashboard.detailDialog.confidenceValue", {
          value: pct(boundary.confidence, 0),
        })}
      </p>
      <div className="flex flex-wrap gap-2">
        {!confirmed && !inReview && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void run(() => confirmBoundary(d.id))}
          >
            <Check className="size-3.5" />
            {t("dashboard.detailDialog.boundaryConfirm")}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onEditOnMap}>
          <Pencil className="size-3.5" />
          {t("dashboard.detailDialog.boundaryEditOnMap")}
        </Button>
        {d.boundaryBeforeManualEdit && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void restoreOriginal()}
            title={t("dashboard.detailDialog.boundaryRestoreHint", {
              label: candidateLabel(t, d.boundaryBeforeManualEdit),
              area: num(d.boundaryBeforeManualEdit.areaSqm),
            })}
          >
            <RotateCcw className="size-3.5" />
            {t("dashboard.detailDialog.boundaryRestore")}
          </Button>
        )}
        {boundary.polygon.type === "MultiPolygon" && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(() =>
                updateBoundary(d.id, withoutExtraComponents(boundary)),
              )
            }
          >
            {t("dashboard.detailDialog.boundaryExcludePartAction")}
          </Button>
        )}
      </div>

      {others.length > 0 && (
        // Open when the boundary still has to be checked: the other
        // proposals are then part of the decision.
        <Disclosure
          key={`${d.id}-${boundary.reviewRequired ? "review" : "ok"}`}
          defaultOpen={boundary.reviewRequired === true}
          title={t("dashboard.detailDialog.boundaryAlternativesCount", {
            count: Math.min(others.length, 4),
          })}
        >
          <div className="space-y-1">
            {others.slice(0, 4).map((candidate, index) => (
              <div
                key={`${candidate.provider ?? candidate.source}-${index}`}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0 truncate">
                  {candidateLabel(t, candidate)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {num(candidate.areaSqm)} m² · {pct(candidate.confidence, 0)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 text-xs"
                  disabled={busy}
                  onClick={() => setPending(candidate)}
                >
                  {t("dashboard.detailDialog.boundaryAdopt")}
                </Button>
              </div>
            ))}
          </div>
        </Disclosure>
      )}

      <Dialog
        open={pending != null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("dashboard.detailDialog.boundaryAdoptTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("dashboard.detailDialog.boundaryAdoptDescription")}
            </DialogDescription>
          </DialogHeader>
          {pending && (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Metric
                label={t("dashboard.detailDialog.boundaryCurrent")}
                value={`${num(boundary.areaSqm)} m² · ${pct(boundary.confidence, 0)}`}
              />
              <Metric
                label={candidateLabel(t, pending)}
                value={`${num(pending.areaSqm)} m² · ${pct(pending.confidence, 0)}`}
              />
            </div>
          )}
          {pending && pending.confidence < boundary.confidence && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <TriangleAlert
                aria-hidden
                className="mt-0.5 size-3.5 shrink-0 text-warning-foreground"
              />
              {t("dashboard.detailDialog.boundaryAdoptWeaker")}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPending(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                const candidate = pending;
                setPending(null);
                if (candidate) void adopt(candidate);
              }}
            >
              {t("dashboard.detailDialog.boundaryAdopt")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
