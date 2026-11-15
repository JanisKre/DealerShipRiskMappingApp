import { useEffect, useMemo, useState } from "react";
import type { AnalyzedDealership } from "@shared/types";
import { effectiveVehicleCount } from "@shared/risk-math";
import { useAppStore } from "@renderer/store/appStore";
import { useMapStore } from "@renderer/store/mapStore";
import type { DetectionEditDraft } from "./DetectionOverlay";

/**
 * The manual vehicle review on the map: which location is being reviewed,
 * the unsaved draft (added and removed points, count), and start, cancel
 * and save. Selecting another location ends the review.
 */
export function useDetectionEditing(
  withCoords: AnalyzedDealership[],
  selectedId: string | null,
): {
  editId: string | null;
  draft: DetectionEditDraft | null;
  setDraft: (draft: DetectionEditDraft | null) => void;
  /** The location under review, while one is. */
  reviewed: AnalyzedDealership | null;
  start: () => void;
  cancel: () => void;
  save: () => Promise<void>;
} {
  const detectionEditing = useMapStore((s) => s.detectionEditing);
  const setDetectionEditing = useMapStore((s) => s.setDetectionEditing);
  const setEditing = useMapStore((s) => s.setEditing);
  const saveManualVehicleDetection = useAppStore(
    (s) => s.saveManualVehicleDetection,
  );
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DetectionEditDraft | null>(null);

  const reviewed = useMemo(
    () => withCoords.find((d) => d.id === editId) ?? null,
    [withCoords, editId],
  );

  function start(): void {
    const dealership = withCoords.find((d) => d.id === selectedId);
    if (!dealership?.detection) return;
    setEditId(dealership.id);
    setDraft({
      manualVehicleCount: effectiveVehicleCount(dealership.detection),
      manualVehiclePoints: [
        ...(dealership.detection.manualVehiclePoints ?? []),
      ],
      manualVehicleRemovedPoints: [
        ...(dealership.detection.manualVehicleRemovedPoints ?? []),
      ],
    });
    setEditing(false);
    setDetectionEditing(true);
  }

  function cancel(): void {
    setDetectionEditing(false);
    setEditId(null);
    setDraft(null);
  }

  async function save(): Promise<void> {
    if (!editId || !draft) return;
    try {
      await saveManualVehicleDetection(
        editId,
        draft.manualVehicleCount,
        draft.manualVehiclePoints,
        draft.manualVehicleRemovedPoints,
      );
      setDetectionEditing(false);
      setEditId(null);
      setDraft(null);
    } catch (error) {
      console.error("Saving manual vehicle review failed:", error);
    }
  }

  useEffect(() => {
    if (detectionEditing && editId && selectedId !== editId) {
      setDetectionEditing(false);
      setEditId(null);
      setDraft(null);
    }
  }, [detectionEditing, editId, selectedId, setDetectionEditing]);

  return { editId, draft, setDraft, reviewed, start, cancel, save };
}
