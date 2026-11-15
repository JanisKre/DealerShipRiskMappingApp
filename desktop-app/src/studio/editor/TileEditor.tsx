import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Eye,
  EyeOff,
  Keyboard,
  LoaderCircle,
  Maximize,
  MousePointer2,
  Redo2,
  RotateCw,
  SquareDashed,
  SquarePlus,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover";
import { Separator } from "@renderer/components/ui/separator";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@renderer/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip";
import { cn } from "@renderer/lib/utils";
import { api, type LabelMode, type SaveResult } from "@studio/api";
import i18n from "@studio/i18n";
import { errorText, showError } from "@studio/lib";
import { share } from "@studio/numbers";
import {
  boxState,
  counts,
  decide,
  finalize,
  manualBox,
  openIndices,
  unanswered,
  type Decision,
  type TileBox,
  type TileData,
} from "./boxes";
import {
  TILE_PX,
  boxAtClick,
  boxFromDrag,
  centre,
  hitTest,
  moveBy,
  resizeCorner,
  rotateBy,
  rotateTowards,
  rotationHandle,
  round2,
  type Pt,
} from "./geometry";
import { SaveQueue, failureOf, type SaveFailure } from "./saveQueue";

type Tool = "select" | "add" | "draw" | "pan";

type Drag =
  | { kind: "pan"; start: Pt; view: View }
  | { kind: "move"; index: number; start: Pt; base: TileBox[] }
  | { kind: "resize"; index: number; corner: number; base: TileBox[] }
  | { kind: "rotate"; index: number; base: TileBox[] }
  | { kind: "draw"; start: Pt; current: Pt };

interface View {
  z: number;
  px: number;
  py: number;
}

/** Why saving is paused: it resumes by itself (locked, offline) or after a reload. */
type Pause = Exclude<SaveFailure, "rejected"> | null;

const COLORS = {
  car: "var(--box-car)",
  open: "var(--box-open)",
  no: "var(--box-no)",
  existing: "var(--box-existing)",
};

/** One queue for the whole page: saves of a tile never overtake each other. */
export const saveQueue = new SaveQueue((r) =>
  api.saveTile(r.mode, r.stem, r.boxes, r.done),
);
saveQueue.onDropped((r, e) =>
  toast.error(i18n.t("editor.dropped", { stem: r.stem, reason: errorText(e) })),
);

let editorUnsaved = false;
window.addEventListener("beforeunload", (e) => {
  if (editorUnsaved || saveQueue.pending() > 0) e.preventDefault();
});

/** Elements where typing goes into the element itself: no shortcut at all. */
const TEXT_ENTRY =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role=dialog], [role=alertdialog], [role=menu], [role=listbox]";

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/**
 * Room kept free below the tile at "fit" for the selection card, so the card
 * never covers the tile: one row on a wide canvas, two on a narrow one.
 */
const cardSpace = (width: number): number => (width >= 760 ? 64 : 104);

export interface TileEditorProps {
  mode: LabelMode;
  stem: string;
  position: string;
  locked: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  onNavigate: (dir: -1 | 1) => void;
  onSaved: (stem: string, result: SaveResult) => void;
}

export function TileEditor({
  mode,
  stem,
  position,
  locked: jobLocked,
  hasPrev,
  hasNext,
  onNavigate,
  onSaved,
}: TileEditorProps): React.JSX.Element {
  const { t } = useTranslation();
  const [tile, setTile] = useState<TileData | null>(null);
  const [boxes, setBoxesState] = useState<TileBox[]>([]);
  const [past, setPast] = useState<TileBox[][]>([]);
  const [future, setFuture] = useState<TileBox[][]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [view, setView] = useState<View>({ z: 1, px: 0, py: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  // Edits are counted; a save stores one count. Refs, so a save, the unmount
  // cleanup and the keyboard always see the latest values, not a stale render.
  const [rev, setRev] = useState(0);
  const [savedRev, setSavedRev] = useState(0);
  const revRef = useRef(0);
  const savedRevRef = useRef(0);
  const rejectedRevRef = useRef(-1);
  const inFlight = useRef(false);
  const boxesRef = useRef<TileBox[]>([]);
  const [saving, setSaving] = useState(false);
  const [pause, setPause] = useState<Pause>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // A finished audit tile is merged into your labels: look, but do not edit.
  const readOnly = mode === "audit" && Boolean(tile?.done);
  const locked = jobLocked || pause === "locked";
  const dirty = rev !== savedRev;

  const setBoxes = (next: TileBox[]): void => {
    boxesRef.current = next;
    setBoxesState(next);
  };
  const bump = (): void => {
    revRef.current += 1;
    setRev(revRef.current);
  };
  const markSaved = (r: number): void => {
    savedRevRef.current = Math.max(savedRevRef.current, r);
    setSavedRev(savedRevRef.current);
  };

  useEffect(() => {
    editorUnsaved = dirty && rev !== rejectedRevRef.current;
    return () => {
      editorUnsaved = false;
    };
  }, [dirty, rev]);

  // --- loading and saving --------------------------------------------------------

  const fit = useCallback((): void => {
    const el = wrapRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const free = Math.max(120, height - cardSpace(width));
    const z = (Math.min(width, free) / TILE_PX) * 0.96;
    setView({
      z,
      px: (width - TILE_PX * z) / 2,
      py: (free - TILE_PX * z) / 2,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setTile(null);
    api
      .tile(mode, stem)
      .then((data) => {
        if (cancelled) return;
        // Edits you left here while saving was paused come back with the tile.
        const draft = saveQueue.takeDraft(mode, stem);
        const start = draft?.boxes ?? data.boxes;
        setTile(data);
        boxesRef.current = start;
        setBoxesState(start);
        setPast([]);
        setFuture([]);
        revRef.current = draft ? 1 : 0;
        savedRevRef.current = 0;
        setRev(revRef.current);
        setSavedRev(0);
        const open = openIndices(start);
        setSelected(open.length ? open[0] : null);
        fit();
      })
      .catch((e: unknown) => {
        if (!cancelled) showError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, stem, fit]);

  // Leaving a tile with unsaved edits hands them to the queue as a draft; it
  // keeps trying while labels are locked or the studio is unreachable.
  useEffect(() => {
    return () => {
      const r = revRef.current;
      if (r !== savedRevRef.current && r !== rejectedRevRef.current)
        saveQueue.keepDraft({
          mode,
          stem,
          boxes: boxesRef.current,
          done: false,
        });
    };
  }, [mode, stem]);

  const handleFailure = useCallback(
    (e: unknown, r: number): void => {
      const failure = failureOf(e);
      if (failure === "rejected") {
        // The same content would be refused again: stop until the next edit.
        rejectedRevRef.current = r;
        setSaveError(errorText(e));
        toast.error(errorText(e), { id: `save-${stem}` });
        if ((e as { code?: string }).code === "audit_merged")
          setTile((t) => (t ? { ...t, done: true } : t));
        return;
      }
      setPause(failure);
      if (failure === "reload") showError(e);
    },
    [stem],
  );

  const saveDraft = useCallback(async (): Promise<void> => {
    const r = revRef.current;
    if (inFlight.current || r === savedRevRef.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      const result = await saveQueue.save({
        mode,
        stem,
        boxes: boxesRef.current,
        done: false,
      });
      markSaved(r);
      setSaveError(null);
      setPause(null);
      setTile((t) => (t ? { ...t, done: result.done } : t));
      onSaved(stem, result);
    } catch (e) {
      handleFailure(e, r);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [mode, stem, onSaved, handleFailure]);

  const finish = useCallback(async (): Promise<void> => {
    if (readOnly || locked || pause || inFlight.current || !tile) return;
    const current = boxesRef.current;
    const left = unanswered(current);
    const out = finalize(current);
    const r = revRef.current;
    inFlight.current = true;
    setSaving(true);
    try {
      const result = await saveQueue.save({
        mode,
        stem,
        boxes: out,
        done: true,
      });
      boxesRef.current = out;
      setBoxesState(out);
      markSaved(r);
      setSaveError(null);
      setTile((t) => (t ? { ...t, done: result.done } : t));
      onSaved(stem, result);
      const parts = [t("editor.finished")];
      if (left.suggestions)
        parts.push(
          t("editor.finishedSuggestions", { count: left.suggestions }),
        );
      if (left.labels)
        parts.push(t("editor.finishedLabels", { count: left.labels }));
      toast.success(parts.join(" "));
      if (hasNext) onNavigate(1);
      else
        toast(t("editor.lastTile"), {
          description: t("editor.lastTileHint"),
        });
    } catch (e) {
      handleFailure(e, r);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [
    readOnly,
    locked,
    pause,
    tile,
    mode,
    stem,
    onSaved,
    hasNext,
    onNavigate,
    handleFailure,
    t,
  ]);

  // Drafts save themselves a moment after the last change (no save button).
  // A refused save is not retried until you change something again.
  useEffect(() => {
    if (
      !dirty ||
      saving ||
      locked ||
      pause ||
      drag ||
      readOnly ||
      rev === rejectedRevRef.current
    )
      return;
    const t = setTimeout(() => void saveDraft(), 1200);
    return () => clearTimeout(t);
  }, [dirty, saving, locked, pause, drag, readOnly, rev, saveDraft]);

  // Paused because of a lock or a lost connection: look every few seconds and
  // resume by itself (the autosave above then stores the edits).
  useEffect(() => {
    if (pause !== "locked" && pause !== "offline") return;
    const t = setInterval(() => {
      api
        .job()
        .then(({ job }) => {
          if (!(job?.status === "running" && job.locked)) setPause(null);
          else setPause("locked");
        })
        .catch(() => setPause("offline"));
    }, 3000);
    return () => clearInterval(t);
  }, [pause]);

  // --- editing ---------------------------------------------------------------------

  const commit = useCallback(
    (next: TileBox[], base: TileBox[] = boxesRef.current): void => {
      if (readOnly) return;
      setPast((p) => [...p.slice(-99), base]);
      setFuture([]);
      setBoxes(next);
      bump();
    },
    [readOnly],
  );

  const undo = (): void => {
    if (!past.length || readOnly) return;
    setFuture((f) => [boxes, ...f]);
    setBoxes(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    bump();
  };
  const redo = (): void => {
    if (!future.length || readOnly) return;
    setPast((p) => [...p, boxes]);
    setBoxes(future[0]);
    setFuture((f) => f.slice(1));
    bump();
  };

  const visible = useMemo(
    () =>
      boxes
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => showRejected || boxState(b) !== "rejected"),
    [boxes, showRejected],
  );

  const centreOn = useCallback((index: number, list: TileBox[]): void => {
    const el = wrapRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const [cx, cy] = centre(list[index].corners);
    const free = Math.max(120, height - cardSpace(width));
    const fitZ = (Math.min(width, free) / TILE_PX) * 0.96;
    setView((v) => {
      // The whole tile is on screen: moving it around would only disorient.
      if (v.z <= fitZ * 1.05) return v;
      const sx = v.px + cx * v.z;
      const sy = v.py + cy * v.z;
      const margin = 80;
      if (
        sx > margin &&
        sx < width - margin &&
        sy > margin &&
        sy < free - margin
      )
        return v;
      return { ...v, px: width / 2 - cx * v.z, py: free / 2 - cy * v.z };
    });
  }, []);

  const answer = useCallback(
    (decision: Decision): void => {
      if (selected == null || readOnly) return;
      const next = boxes.map((b, i) =>
        i === selected ? decide(b, decision) : b,
      );
      commit(next);
      const open = openIndices(next);
      const after = open.find((i) => i !== selected) ?? null;
      setSelected(after);
      if (after != null) centreOn(after, next);
    },
    [boxes, selected, commit, centreOn, readOnly],
  );

  const acceptAllOpen = (): void => {
    commit(boxes.map((b) => (boxState(b) === "open" ? decide(b, "car") : b)));
  };

  const removeSelected = (): void => {
    if (selected == null || readOnly) return;
    const b = boxes[selected];
    // Your own boxes are deleted; model boxes are rejected, so the decision is kept.
    const next =
      b.origin === "manual"
        ? boxes.filter((_, i) => i !== selected)
        : boxes.map((x, i) => (i === selected ? decide(x, "no") : x));
    commit(next);
    setSelected(null);
  };

  const rotateSelected = (radians: number): void => {
    // Only accepted boxes turn (the card offers it only for them, too).
    if (selected == null || boxState(boxes[selected]) !== "accepted") return;
    commit(
      boxes.map((b, i) =>
        i === selected
          ? { ...b, corners: round2(rotateBy(b.corners, radians)) }
          : b,
      ),
    );
  };

  /** "Doch ein Fahrzeug": turns a rejected box back into a vehicle. */
  const setClassOfSelected = (): void => {
    if (selected == null) return;
    commit(boxes.map((x, i) => (i === selected ? decide(x, "car") : x)));
  };

  const nextQuestion = (): void => {
    const open = openIndices(boxes);
    if (!open.length) return;
    const after = open.find((i) => selected == null || i > selected) ?? open[0];
    setSelected(after);
    centreOn(after, boxes);
  };

  /** "Später": the next open question; the last one is just left open (deselected). */
  const later = (): void => {
    if (openIndices(boxes).length > 1) nextQuestion();
    else setSelected(null);
  };

  /** After a mouse click on a card button, keys go back to the tile (Enter, Tab). */
  const backToTile = (e: React.MouseEvent): void => {
    if (e.detail > 0) svgRef.current?.focus({ preventScroll: true });
  };

  // --- pointer handling ------------------------------------------------------------

  const toTile = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return [
      (e.clientX - r.left - view.px) / view.z,
      (e.clientY - r.top - view.py) / view.z,
    ];
  };

  const handleAt = (p: Pt): { corner: number } | { rotate: true } | null => {
    if (selected == null) return null;
    const b = boxes[selected];
    const tol = 9 / view.z;
    const rh = rotationHandle(b.corners, 22 / view.z);
    if (Math.hypot(rh[0] - p[0], rh[1] - p[1]) < tol) return { rotate: true };
    const corner = b.corners.findIndex(
      ([x, y]) => Math.hypot(x - p[0], y - p[1]) < tol,
    );
    return corner >= 0 ? { corner } : null;
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    svgRef.current?.setPointerCapture(e.pointerId);
    svgRef.current?.focus({ preventScroll: true });
    const p = toTile(e);
    if (tool === "pan" || spaceDown || e.button === 1) {
      setDrag({ kind: "pan", start: [e.clientX, e.clientY], view });
      return;
    }
    const handle = readOnly ? null : handleAt(p);
    if (handle && selected != null) {
      setDrag(
        "rotate" in handle
          ? { kind: "rotate", index: selected, base: boxes }
          : {
              kind: "resize",
              index: selected,
              corner: handle.corner,
              base: boxes,
            },
      );
      return;
    }
    const inside = p[0] >= 0 && p[1] >= 0 && p[0] <= TILE_PX && p[1] <= TILE_PX;
    const hits = visible.map(({ b }) => b);
    const hit = hitTest(hits, p);
    const index = hit == null ? null : visible[hit].i;
    if (tool === "draw" && inside && !readOnly) {
      setDrag({ kind: "draw", start: p, current: p });
      return;
    }
    if (index != null) {
      setSelected(index);
      if (!readOnly) setDrag({ kind: "move", index, start: p, base: boxes });
      return;
    }
    if (tool === "add" && inside && !readOnly) {
      const neighbours = boxes
        .filter((b) => boxState(b) === "accepted")
        .map((b) => ({ corners: b.corners }));
      const added = manualBox(round2(boxAtClick(p, neighbours)));
      commit([...boxes, added]);
      setSelected(boxes.length);
      return;
    }
    setSelected(null);
    setDrag({ kind: "pan", start: [e.clientX, e.clientY], view });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (!drag) return;
    if (drag.kind === "pan") {
      setView({
        ...drag.view,
        px: drag.view.px + e.clientX - drag.start[0],
        py: drag.view.py + e.clientY - drag.start[1],
      });
      return;
    }
    const p = toTile(e);
    if (drag.kind === "draw") {
      setDrag({ ...drag, current: p });
      return;
    }
    const base = drag.base[drag.index];
    let corners = base.corners;
    if (drag.kind === "move") {
      // A click is not a move: ignore jitter below ~2 screen pixels.
      if (Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) * view.z < 2)
        return;
      // The box centre stays on the tile (the server refuses boxes off the tile).
      const [cx, cy] = centre(base.corners);
      corners = moveBy(
        base.corners,
        clamp(p[0] - drag.start[0], -cx, TILE_PX - cx),
        clamp(p[1] - drag.start[1], -cy, TILE_PX - cy),
      );
    }
    if (drag.kind === "resize")
      corners = resizeCorner(base.corners, drag.corner, [
        clamp(p[0], 0, TILE_PX),
        clamp(p[1], 0, TILE_PX),
      ]);
    if (drag.kind === "rotate") corners = rotateTowards(base.corners, p);
    setBoxes(
      drag.base.map((b, i) => (i === drag.index ? { ...b, corners } : b)),
    );
  };

  const onPointerUp = (): void => {
    if (!drag) return;
    if (drag.kind === "draw") {
      const [a, b] = [drag.start, drag.current];
      if (Math.abs(a[0] - b[0]) > 5 && Math.abs(a[1] - b[1]) > 5) {
        commit([...boxes, manualBox(round2(boxFromDrag(a, b)))]);
        setSelected(boxes.length);
      }
    } else if (drag.kind !== "pan") {
      const moved = boxes[drag.index].corners !== drag.base[drag.index].corners;
      if (moved) {
        const next = boxes.map((b, i) =>
          i === drag.index ? { ...b, corners: round2(b.corners) } : b,
        );
        commit(next, drag.base);
      }
    }
    setDrag(null);
  };

  // Wheel / pinch zoom around the pointer (needs a non-passive listener).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView((v) => {
        const z = Math.min(
          12,
          Math.max(
            0.3,
            v.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)),
          ),
        );
        return {
          z,
          px: mx - ((mx - v.px) / v.z) * z,
          py: my - ((my - v.py) / v.z) * z,
        };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [tile]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // Optional shortcuts; every action also has a button. Keys a focused control
  // uses itself (Enter, Space, Tab on a button, anything in a text field, a
  // dialog or a menu) are left to it: shortcuts act only on the tile or when
  // nothing in particular has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(TEXT_ENTRY)) return;
      const onTile = target === svgRef.current;
      const free =
        onTile ||
        target == null ||
        target === document.body ||
        target === document.documentElement;
      if (e.code === "Space") {
        if (e.type === "keyup") setSpaceDown(false);
        else if (free) {
          setSpaceDown(true);
          e.preventDefault();
        }
        return;
      }
      if (e.type !== "keydown") return;
      if ((e.key === "Enter" || e.key === "Tab") && !free) return;
      // Tab steps through the questions only while the tile has focus; it
      // stays the way to move focus everywhere else (and Shift+Tab always).
      if (
        e.key === "Tab" &&
        (!onTile || e.shiftKey || !openIndices(boxes).length)
      )
        return;
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (meta && (key === "z" || key === "y")) {
        e.preventDefault();
        if (key === "y" || e.shiftKey) redo();
        else undo();
        return;
      }
      if (meta || e.altKey) return;
      const busy = saving || locked || Boolean(pause) || readOnly;
      const keys: Record<string, () => void> = {
        v: () => setTool("select"),
        a: () => setTool("add"),
        b: () => setTool("draw"),
        j: () => answer("car"),
        n: () => answer("no"),
        r: () => rotateSelected(Math.PI / 2),
        Delete: removeSelected,
        Backspace: removeSelected,
        // Finishing is irreversible: not while saving, locked or paused, not on key repeat.
        Enter: () => {
          if (!busy && !e.repeat) void finish();
        },
        Tab: nextQuestion,
        "?": () => setHelpOpen((o) => !o),
      };
      const fn = keys[key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  });

  // --- rendering -------------------------------------------------------------------

  const c = counts(boxes);
  const sel = selected != null ? boxes[selected] : null;
  const selState = sel ? boxState(sel) : null;
  const open = openIndices(boxes);
  const questionNo =
    sel && selState === "open" ? open.indexOf(selected!) + 1 : 0;
  const hs = 5 / view.z;

  // One line on what saving does right now; also shown below 1024 px when it matters.
  const saveState: { text: string; title?: string; problem: boolean } = readOnly
    ? { text: t("editor.saveReadOnly"), problem: false }
    : pause === "reload"
      ? { text: t("editor.saveReload"), problem: true }
      : pause === "offline"
        ? { text: t("editor.saveOffline"), problem: true }
        : locked && dirty
          ? { text: t("editor.savePaused"), problem: true }
          : saveError && rev === rejectedRevRef.current
            ? { text: t("editor.saveFailed"), title: saveError, problem: true }
            : saving || dirty
              ? { text: t("editor.saving"), problem: false }
              : { text: t("editor.saved"), problem: false };
  const notice = readOnly
    ? t("editor.noticeReadOnly")
    : pause === "reload"
      ? t("editor.noticeReload")
      : pause === "offline"
        ? t("editor.noticeOffline")
        : locked
          ? t("editor.noticeLocked")
          : saveError && rev === rejectedRevRef.current
            ? t("editor.noticeFailed", { reason: saveError })
            : null;
  const finishBlocked = readOnly
    ? t("editor.finishMerged")
    : locked || pause
      ? t("editor.finishPaused")
      : null;

  const colorOf = (b: TileBox): string => {
    const s = boxState(b);
    if (s === "rejected") return COLORS.no;
    if (s === "open") return COLORS.open;
    return COLORS.car;
  };

  const cursor =
    drag?.kind === "pan"
      ? "grabbing"
      : tool === "pan" || spaceDown
        ? "grab"
        : tool === "select"
          ? "default"
          : "crosshair";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* toolbar: tools for new boxes, undo, view */}
      <div className="bg-card flex min-w-0 items-center gap-1.5 border-b px-3 py-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={tool === "pan" ? "select" : tool}
          onValueChange={(v) => v && setTool(v as Tool)}
          aria-label={t("editor.toolLabel")}
        >
          <ToolItem
            value="select"
            label={t("editor.toolSelect")}
            hint={t("editor.toolSelectHint")}
            keyHint="V"
          >
            <MousePointer2 />
          </ToolItem>
          <ToolItem
            value="add"
            label={t("editor.toolAdd")}
            hint={t("editor.toolAddHint")}
            keyHint="A"
          >
            <SquarePlus />
          </ToolItem>
          <ToolItem
            value="draw"
            label={t("editor.toolDraw")}
            hint={t("editor.toolDrawHint")}
            keyHint="B"
          >
            <SquareDashed />
          </ToolItem>
        </ToggleGroup>
        <Separator orientation="vertical" className="mx-1 h-6" />
        <IconButton
          label={t("editor.undo")}
          keyHint={t("editor.keyUndo")}
          disabled={!past.length || readOnly}
          onClick={undo}
        >
          <Undo2 />
        </IconButton>
        <IconButton
          label={t("editor.redo")}
          keyHint={t("editor.keyRedo")}
          disabled={!future.length || readOnly}
          onClick={redo}
        >
          <Redo2 />
        </IconButton>
        <div className="min-w-0 flex-1" />
        <Popover open={helpOpen} onOpenChange={setHelpOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={t("editor.shortcutsHint")}
                >
                  <Keyboard />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>{t("editor.shortcutsHint")}</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-80 p-3">
            <ShortcutList />
          </PopoverContent>
        </Popover>
        <IconButton
          label={t(
            showRejected ? "editor.hideRejected" : "editor.showRejected",
          )}
          onClick={() => setShowRejected((x) => !x)}
        >
          {showRejected ? <Eye /> : <EyeOff />}
        </IconButton>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="tabular-nums"
              aria-label={t("editor.fit")}
              onClick={fit}
            >
              <Maximize /> {share(view.z)}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            {t("editor.fit")}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* canvas */}
      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-black"
      >
        {notice && (
          <div
            role="status"
            className="bg-warning/15 text-warning-foreground absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-3 py-1.5 text-xs"
          >
            {locked && !readOnly && (
              <LoaderCircle className="size-3.5 animate-spin" />
            )}
            {notice}
          </div>
        )}
        <svg
          ref={svgRef}
          role="application"
          tabIndex={0}
          aria-label={t("editor.tileAria", { stem })}
          className="absolute inset-0 size-full touch-none select-none"
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <g transform={`translate(${view.px} ${view.py}) scale(${view.z})`}>
            <image
              href={api.imageUrl(stem)}
              width={TILE_PX}
              height={TILE_PX}
              style={{ imageRendering: view.z > 2.5 ? "pixelated" : "auto" }}
            />
            <rect
              width={TILE_PX}
              height={TILE_PX}
              fill="none"
              stroke="#ffffff33"
              vectorEffect="non-scaling-stroke"
            />
            {tile?.existing?.map((b, i) => (
              <polygon
                key={`e${i}`}
                points={b.corners.map((p) => p.join(",")).join(" ")}
                fill="none"
                stroke={COLORS.existing}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                opacity={0.8}
              />
            ))}
            {visible.map(({ b, i }) => {
              const color = colorOf(b);
              const st = boxState(b);
              const isSel = i === selected;
              return (
                <g key={i}>
                  {isSel && (
                    <polygon
                      points={b.corners.map((p) => p.join(",")).join(" ")}
                      fill="none"
                      stroke="#fff"
                      strokeWidth={4}
                      vectorEffect="non-scaling-stroke"
                      opacity={0.9}
                    />
                  )}
                  <polygon
                    points={b.corners.map((p) => p.join(",")).join(" ")}
                    fill={color}
                    fillOpacity={st === "rejected" ? 0.04 : isSel ? 0.22 : 0.1}
                    stroke={color}
                    strokeWidth={isSel ? 2.2 : 1.6}
                    strokeDasharray={st === "accepted" ? undefined : "4 3"}
                    vectorEffect="non-scaling-stroke"
                    opacity={st === "rejected" ? 0.7 : 1}
                  />
                </g>
              );
            })}
            {sel && (
              <g>
                {(() => {
                  const rh = rotationHandle(sel.corners, 22 / view.z);
                  const top: Pt = [
                    (sel.corners[0][0] + sel.corners[1][0]) / 2,
                    (sel.corners[0][1] + sel.corners[1][1]) / 2,
                  ];
                  return (
                    <>
                      <line
                        x1={top[0]}
                        y1={top[1]}
                        x2={rh[0]}
                        y2={rh[1]}
                        stroke="#fff"
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                      <circle
                        cx={rh[0]}
                        cy={rh[1]}
                        r={hs * 1.1}
                        fill="#fff"
                        stroke="#000"
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                    </>
                  );
                })()}
                {sel.corners.map(([x, y], k) => (
                  <rect
                    key={k}
                    x={x - hs}
                    y={y - hs}
                    width={hs * 2}
                    height={hs * 2}
                    fill="#fff"
                    stroke="#000"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            )}
            {drag?.kind === "draw" && (
              <polygon
                points={boxFromDrag(drag.start, drag.current)
                  .map((p) => p.join(","))
                  .join(" ")}
                fill="none"
                stroke="#fff"
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        </svg>

        {/* selection card: what you can do with the selected box. It sits in
            the room "fit" keeps free below the tile, so it never covers it. */}
        {sel && (
          <div className="bg-card/95 absolute bottom-2 left-1/2 z-10 w-max max-w-[calc(100%-16px)] -translate-x-1/2 rounded-lg border px-3 py-2 shadow-lg backdrop-blur">
            {readOnly ? (
              <span className="text-muted-foreground text-sm">
                {selState === "rejected"
                  ? t("editor.rejected")
                  : selState === "open"
                    ? t("editor.leftOpen")
                    : t("editor.vehicle")}
              </span>
            ) : selState === "open" || sel.origin === "label" ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex items-center gap-2">
                  <CircleHelp className="size-4 shrink-0 text-[var(--box-open)]" />
                  <span className="text-sm font-medium">
                    {sel.origin === "label"
                      ? t("editor.askLabel")
                      : mode === "audit"
                        ? t("editor.askAudit")
                        : t("editor.askSuggestion")}
                  </span>
                  {sel.origin === "label" && selState !== "open" && (
                    <Badge variant="outline">
                      {selState === "rejected"
                        ? t("editor.answerNo")
                        : t("editor.answerYes")}
                    </Badge>
                  )}
                  {questionNo > 0 && (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {t("editor.questionOf", {
                        n: questionNo,
                        total: open.length,
                      })}
                    </span>
                  )}
                  {typeof sel.claude === "string" && sel.claude && (
                    <Badge variant="outline">
                      {t("editor.claude", { answer: sel.claude })}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <HintButton label={t("editor.yes")} keyHint="J">
                    <Button
                      size="sm"
                      onClick={(e) => {
                        answer("car");
                        backToTile(e);
                      }}
                    >
                      <Check /> {t("editor.yes")}
                    </Button>
                  </HintButton>
                  <HintButton label={t("editor.no")} keyHint="N">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={(e) => {
                        answer("no");
                        backToTile(e);
                      }}
                    >
                      <X /> {t("editor.no")}
                    </Button>
                  </HintButton>
                  {selState === "open" && (
                    <>
                      <Separator orientation="vertical" className="mx-1 h-5" />
                      <HintButton
                        label={
                          open.length > 1
                            ? t("editor.laterHint")
                            : t("editor.laterLastHint")
                        }
                        keyHint={open.length > 1 ? "Tab" : undefined}
                      >
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            later();
                            backToTile(e);
                          }}
                        >
                          {t("editor.later")}
                        </Button>
                      </HintButton>
                      {open.length > 1 && (
                        <HintButton label={t("editor.allYesHint")}>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              acceptAllOpen();
                              backToTile(e);
                            }}
                          >
                            {t("editor.allYes", { count: open.length })}
                          </Button>
                        </HintButton>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : selState === "rejected" ? (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm">
                  {t("editor.rejected")}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setClassOfSelected()}
                >
                  <Check /> {t("editor.restore")}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground px-1 text-sm">
                  {t("editor.vehicle")}
                </span>
                <IconButton
                  label={t("editor.rotate")}
                  keyHint="R"
                  onClick={() => rotateSelected(Math.PI / 2)}
                >
                  <RotateCw />
                </IconButton>
                <IconButton
                  label={
                    sel.origin === "manual"
                      ? t("editor.delete")
                      : t("editor.reject")
                  }
                  keyHint={t("editor.keyDelete")}
                  onClick={removeSelected}
                >
                  <Trash2 />
                </IconButton>
              </div>
            )}
          </div>
        )}
        {!tile && (
          <div className="text-muted-foreground absolute inset-0 grid place-items-center text-sm">
            <LoaderCircle className="size-5 animate-spin" />
          </div>
        )}
      </div>

      {/* footer */}
      <div className="bg-card flex min-w-0 items-center gap-3 border-t px-3 py-2 text-sm">
        <Button
          size="sm"
          variant="ghost"
          disabled={!hasPrev}
          onClick={() => onNavigate(-1)}
        >
          <ChevronLeft />{" "}
          <span className="hidden lg:inline">{t("editor.back")}</span>
        </Button>
        <div className="min-w-0">
          <div className="truncate font-mono text-xs" title={stem}>
            {stem}
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {tile?.done ? t("editor.positionDone", { position }) : position}
          </div>
        </div>
        <div className="hidden items-center gap-3 text-xs tabular-nums xl:flex">
          <Legend
            color={COLORS.car}
            label={t("editor.legendVehicles", { count: c.accepted })}
          />
          <Legend
            color={COLORS.open}
            label={t("editor.legendOpen", { count: c.open })}
            dashed
          />
          <Legend
            color={COLORS.no}
            label={t("editor.legendRejected", { count: c.rejected })}
            dashed
          />
        </div>
        <div className="flex-1" />
        {c.open > 0 && !readOnly && !(sel && selState === "open") && (
          <HintButton label={t("editor.nextQuestion")} keyHint="Tab">
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                nextQuestion();
                backToTile(e);
              }}
            >
              <CircleHelp />
              <span className="xl:hidden">
                {t("editor.openCount", { count: c.open })}
              </span>
              <span className="hidden xl:inline">
                {t("editor.nextQuestion")}
              </span>
            </Button>
          </HintButton>
        )}
        <span
          role="status"
          title={saveState.title}
          className={cn(
            "truncate text-xs whitespace-nowrap",
            saveState.problem
              ? "text-warning-foreground"
              : "text-muted-foreground hidden lg:inline",
          )}
        >
          {saveState.text}
        </span>
        <HintButton
          label={finishBlocked ?? t("editor.finish")}
          keyHint={finishBlocked ? undefined : "Enter"}
        >
          <span className="shrink-0">
            <Button
              size="sm"
              disabled={saving || Boolean(finishBlocked) || !tile}
              onClick={() => void finish()}
            >
              <Check /> {t("editor.finish")} {hasNext && <ChevronRight />}
            </Button>
          </span>
        </HintButton>
      </div>
    </div>
  );
}

function ToolItem({
  value,
  label,
  hint,
  keyHint,
  children,
}: {
  value: string;
  label: string;
  hint: string;
  keyHint?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToggleGroupItem
          value={value}
          aria-label={label}
          className="gap-1.5 px-2.5"
        >
          {children}
          <span className="hidden xl:inline">{label}</span>
        </ToggleGroupItem>
      </TooltipTrigger>
      <TooltipContent>
        {hint}
        {keyHint && <Kbd>{keyHint}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

/** A tooltip with the action and its key for a control that has its own label. */
function HintButton({
  label,
  keyHint,
  children,
}: {
  label: string;
  keyHint?: string;
  children: React.ReactElement;
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        {label}
        {keyHint && <Kbd>{keyHint}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

/** A key name in a tooltip or the shortcut list. */
function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="bg-muted text-muted-foreground ml-2 rounded border px-1 font-mono text-[10px]">
      {children}
    </kbd>
  );
}

/** Every shortcut of the editor, opened from the toolbar or with "?". */
function ShortcutList(): React.JSX.Element {
  const { t } = useTranslation();
  const rows: [string, string][] = [
    ["J", t("editor.keys.yes")],
    ["N", t("editor.keys.no")],
    ["Tab", t("editor.keys.tab")],
    ["Enter", t("editor.keys.enter")],
    ["V / A / B", t("editor.keys.tools")],
    ["R", t("editor.keys.rotate")],
    [t("editor.keyDelete"), t("editor.keys.delete")],
    [t("editor.keyUndo"), t("editor.keys.undo")],
    [t("editor.keyRedo"), t("editor.keys.redo")],
    [t("editor.keySpace"), t("editor.keys.pan")],
    ["⊙", t("editor.keys.wheel")],
    ["?", t("editor.keys.help")],
  ];
  return (
    <div className="space-y-2 text-sm">
      <div className="font-medium">{t("editor.shortcuts")}</div>
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-xs">
        {rows.map(([key, text]) => (
          <div key={text} className="contents">
            <dt className="text-right whitespace-nowrap">
              <kbd className="bg-muted rounded border px-1 font-mono text-[10px]">
                {key}
              </kbd>
            </dt>
            <dd className="text-muted-foreground">{text}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground text-[11px] leading-snug">
        {t("editor.shortcutsNote")}
      </p>
    </div>
  );
}

function IconButton({
  label,
  keyHint,
  disabled,
  onClick,
  children,
}: {
  label: string;
  keyHint?: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {keyHint && <Kbd>{keyHint}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

function Legend({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn("inline-block h-2.5 w-3.5 rounded-[3px] border-2")}
        style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }}
      />
      {label}
    </span>
  );
}
