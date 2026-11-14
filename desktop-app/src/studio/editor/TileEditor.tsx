import {
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Eye,
  EyeOff,
  Hand,
  LoaderCircle,
  Maximize,
  MousePointer2,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  SquareDashed,
  SquarePlus,
  Trash2,
  Truck,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
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
import { api, type LabelMode } from "@studio/api";
import {
  boxState,
  counts,
  decide,
  effectiveClass,
  finalize,
  manualBox,
  openIndices,
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

const COLORS = {
  car: "var(--box-car)",
  large: "var(--box-large)",
  open: "var(--box-open)",
  no: "var(--box-no)",
  existing: "var(--box-existing)",
};

export interface TileEditorProps {
  mode: LabelMode;
  stem: string;
  position: string;
  locked: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  onNavigate: (dir: -1 | 1) => void;
  onSaved: (stem: string, done: boolean) => void;
}

export function TileEditor({
  mode,
  stem,
  position,
  locked,
  hasPrev,
  hasNext,
  onNavigate,
  onSaved,
}: TileEditorProps): React.JSX.Element {
  const [tile, setTile] = useState<TileData | null>(null);
  const [boxes, setBoxes] = useState<TileBox[]>([]);
  const [past, setPast] = useState<TileBox[][]>([]);
  const [future, setFuture] = useState<TileBox[][]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [cls, setCls] = useState<0 | 1>(0);
  const [view, setView] = useState<View>({ z: 1, px: 0, py: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const stateRef = useRef({ boxes, dirty, stem, mode });
  stateRef.current = { boxes, dirty, stem, mode };

  // --- loading and saving --------------------------------------------------------

  const fit = useCallback((): void => {
    const el = wrapRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const z = (Math.min(width, height) / TILE_PX) * 0.96;
    setView({
      z,
      px: (width - TILE_PX * z) / 2,
      py: (height - TILE_PX * z) / 2,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setTile(null);
    api
      .tile(mode, stem)
      .then((data) => {
        if (cancelled) return;
        setTile(data);
        setBoxes(data.boxes);
        setPast([]);
        setFuture([]);
        setDirty(false);
        const open = openIndices(data.boxes);
        setSelected(open.length ? open[0] : null);
        fit();
      })
      .catch((e: Error) => toast.error(`Kachel laden: ${e.message}`));
    return () => {
      cancelled = true;
    };
  }, [mode, stem, fit]);

  // Leaving a tile with changes keeps them as a draft.
  useEffect(() => {
    return () => {
      const s = stateRef.current;
      if (s.dirty) {
        void api
          .saveTile(s.mode, s.stem, s.boxes, false)
          .then(() => onSaved(s.stem, false))
          .catch((e: Error) =>
            toast.error(`Entwurf nicht gespeichert: ${e.message}`),
          );
      }
    };
  }, [stem, mode, onSaved]);

  const save = useCallback(
    async (done: boolean): Promise<boolean> => {
      setSaving(true);
      try {
        const out = done ? finalize(boxes) : boxes;
        await api.saveTile(mode, stem, out, done);
        setDirty(false);
        if (done) setBoxes(out);
        onSaved(stem, done);
        return true;
      } catch (e) {
        toast.error((e as Error).message);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [boxes, mode, stem, onSaved],
  );

  const finish = useCallback(async (): Promise<void> => {
    const open = counts(boxes).open;
    if (await save(true)) {
      toast.success(
        open
          ? `Kachel fertig – ${open} unbeantwortete Vorschläge als „kein Fahrzeug“ gespeichert.`
          : "Kachel fertig.",
      );
      if (hasNext) onNavigate(1);
    }
  }, [boxes, save, hasNext, onNavigate]);

  // --- editing ---------------------------------------------------------------------

  const commit = useCallback(
    (next: TileBox[], base: TileBox[] = boxes): void => {
      setPast((p) => [...p.slice(-99), base]);
      setFuture([]);
      setBoxes(next);
      setDirty(true);
    },
    [boxes],
  );

  const undo = (): void => {
    if (!past.length) return;
    setFuture((f) => [boxes, ...f]);
    setBoxes(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setDirty(true);
  };
  const redo = (): void => {
    if (!future.length) return;
    setPast((p) => [...p, boxes]);
    setBoxes(future[0]);
    setFuture((f) => f.slice(1));
    setDirty(true);
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
    const fitZ = (Math.min(width, height) / TILE_PX) * 0.96;
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
        sy < height - margin
      )
        return v;
      return { ...v, px: width / 2 - cx * v.z, py: height / 2 - cy * v.z };
    });
  }, []);

  const answer = useCallback(
    (decision: Decision): void => {
      if (selected == null) return;
      const next = boxes.map((b, i) =>
        i === selected ? decide(b, decision) : b,
      );
      commit(next);
      const open = openIndices(next);
      const after = open.find((i) => i !== selected) ?? null;
      setSelected(after);
      if (after != null) centreOn(after, next);
    },
    [boxes, selected, commit, centreOn],
  );

  const acceptAllOpen = (): void => {
    commit(
      boxes.map((b) =>
        boxState(b) === "open"
          ? decide(b, b.cls === 1 ? "large_vehicle" : "car")
          : b,
      ),
    );
  };

  const removeSelected = (): void => {
    if (selected == null) return;
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
    if (selected == null) return;
    commit(
      boxes.map((b, i) =>
        i === selected
          ? { ...b, corners: round2(rotateBy(b.corners, radians)) }
          : b,
      ),
    );
  };

  const setClassOfSelected = (c: 0 | 1): void => {
    setCls(c);
    if (selected == null) return;
    const b = boxes[selected];
    if (boxState(b) === "rejected") return;
    commit(
      boxes.map((x, i) =>
        i === selected ? decide(x, c === 1 ? "large_vehicle" : "car") : x,
      ),
    );
  };

  const nextQuestion = (): void => {
    const open = openIndices(boxes);
    if (!open.length) return;
    const after = open.find((i) => selected == null || i > selected) ?? open[0];
    setSelected(after);
    centreOn(after, boxes);
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
    const p = toTile(e);
    if (tool === "pan" || spaceDown || e.button === 1) {
      setDrag({ kind: "pan", start: [e.clientX, e.clientY], view });
      return;
    }
    const handle = handleAt(p);
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
    if (tool === "draw" && inside) {
      setDrag({ kind: "draw", start: p, current: p });
      return;
    }
    if (index != null) {
      setSelected(index);
      setDrag({ kind: "move", index, start: p, base: boxes });
      return;
    }
    if (tool === "add" && inside) {
      const neighbours = boxes
        .filter((b) => boxState(b) === "accepted")
        .map((b) => ({ corners: b.corners, cls: effectiveClass(b) }));
      const added = manualBox(round2(boxAtClick(p, cls, neighbours)), cls);
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
      corners = moveBy(
        base.corners,
        p[0] - drag.start[0],
        p[1] - drag.start[1],
      );
    }
    if (drag.kind === "resize")
      corners = resizeCorner(base.corners, drag.corner, p);
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
        commit([...boxes, manualBox(round2(boxFromDrag(a, b)), cls)]);
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

  const zoomBy = (factor: number): void => {
    const el = wrapRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setView((v) => {
      const z = Math.min(12, Math.max(0.3, v.z * factor));
      return {
        z,
        px: width / 2 - ((width / 2 - v.px) / v.z) * z,
        py: height / 2 - ((height / 2 - v.py) / v.z) * z,
      };
    });
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // Optional shortcuts; every action also has a button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [role=dialog]")) return;
      const meta = e.metaKey || e.ctrlKey;
      if (e.code === "Space") {
        setSpaceDown(e.type === "keydown");
        if (e.type === "keydown") e.preventDefault();
        return;
      }
      if (e.type !== "keydown") return;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (meta) return;
      const keys: Record<string, () => void> = {
        v: () => setTool("select"),
        a: () => setTool("add"),
        b: () => setTool("draw"),
        h: () => setTool("pan"),
        j: () => answer("car"),
        l: () => answer("large_vehicle"),
        n: () => answer("no"),
        r: () => rotateSelected(Math.PI / 2),
        Delete: removeSelected,
        Backspace: removeSelected,
        Enter: () => void finish(),
        Tab: nextQuestion,
      };
      const fn = keys[e.key];
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

  const colorOf = (b: TileBox): string => {
    const s = boxState(b);
    if (s === "rejected") return COLORS.no;
    if (s === "open") return COLORS.open;
    return effectiveClass(b) === 1 ? COLORS.large : COLORS.car;
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
      {/* toolbar */}
      <div className="bg-card flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={tool}
          onValueChange={(v) => v && setTool(v as Tool)}
          aria-label="Werkzeug"
        >
          <ToolItem
            value="select"
            label="Auswählen und verschieben"
            keyHint="V"
          >
            <MousePointer2 />
          </ToolItem>
          <ToolItem
            value="add"
            label="Fahrzeug per Klick setzen (richtet sich nach den Nachbarn aus)"
            keyHint="A"
          >
            <SquarePlus />
          </ToolItem>
          <ToolItem value="draw" label="Box aufziehen" keyHint="B">
            <SquareDashed />
          </ToolItem>
          <ToolItem
            value="pan"
            label="Bild verschieben (auch Leertaste halten)"
            keyHint="H"
          >
            <Hand />
          </ToolItem>
        </ToggleGroup>
        <Separator orientation="vertical" className="h-6" />
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={String(cls)}
          onValueChange={(v) => v && setClassOfSelected(Number(v) as 0 | 1)}
          aria-label="Klasse"
        >
          <ToolItem value="0" label="Auto, Transporter, Pickup">
            <Car /> Auto
          </ToolItem>
          <ToolItem value="1" label="Lkw, Bus, Wohnmobil, Anhänger">
            <Truck /> Groß
          </ToolItem>
        </ToggleGroup>
        <Separator orientation="vertical" className="h-6" />
        <IconButton
          label="Ja, Fahrzeug"
          keyHint="J"
          disabled={!sel}
          onClick={() => answer(cls === 1 ? "large_vehicle" : "car")}
        >
          <Check className="text-[var(--box-car)]" />
        </IconButton>
        <IconButton
          label="Nein, kein Fahrzeug"
          keyHint="N"
          disabled={!sel}
          onClick={() => answer("no")}
        >
          <X className="text-[var(--box-no)]" />
        </IconButton>
        <IconButton
          label="15° nach links drehen"
          disabled={!sel}
          onClick={() => rotateSelected(-Math.PI / 12)}
        >
          <RotateCcw />
        </IconButton>
        <IconButton
          label="15° nach rechts drehen (R: 90°)"
          disabled={!sel}
          onClick={() => rotateSelected(Math.PI / 12)}
        >
          <RotateCw />
        </IconButton>
        <IconButton
          label="Löschen bzw. ablehnen"
          keyHint="Entf"
          disabled={!sel}
          onClick={removeSelected}
        >
          <Trash2 />
        </IconButton>
        <Separator orientation="vertical" className="h-6" />
        <IconButton
          label="Rückgängig"
          keyHint="⌘Z"
          disabled={!past.length}
          onClick={undo}
        >
          <Undo2 />
        </IconButton>
        <IconButton
          label="Wiederholen"
          keyHint="⇧⌘Z"
          disabled={!future.length}
          onClick={redo}
        >
          <Redo2 />
        </IconButton>
        <Separator orientation="vertical" className="h-6" />
        <IconButton label="Verkleinern" onClick={() => zoomBy(1 / 1.4)}>
          <ZoomOut />
        </IconButton>
        <span className="text-muted-foreground w-12 text-center text-xs tabular-nums">
          {Math.round(view.z * 100)} %
        </span>
        <IconButton
          label="Vergrößern (auch Mausrad)"
          onClick={() => zoomBy(1.4)}
        >
          <ZoomIn />
        </IconButton>
        <IconButton label="Ganze Kachel" onClick={fit}>
          <Maximize />
        </IconButton>
        <div className="flex-1" />
        <IconButton
          label={
            showRejected ? "Abgelehnte ausblenden" : "Abgelehnte einblenden"
          }
          onClick={() => setShowRejected((s) => !s)}
        >
          {showRejected ? <Eye /> : <EyeOff />}
        </IconButton>
      </div>

      {/* canvas */}
      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-black"
      >
        {locked && (
          <div className="bg-warning/15 text-warning-foreground absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-3 py-1.5 text-xs">
            <LoaderCircle className="size-3.5 animate-spin" /> Neue Vorschläge
            werden berechnet. Speichern geht in ein, zwei Minuten wieder.
          </div>
        )}
        <svg
          ref={svgRef}
          role="application"
          aria-label={`Kachel ${stem}`}
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

        {/* question card */}
        {sel && (selState === "open" || sel.origin === "label") && (
          <div className="bg-card/95 absolute bottom-3 left-1/2 z-10 w-max max-w-[calc(100%-24px)] -translate-x-1/2 rounded-lg border px-3 py-2.5 shadow-lg backdrop-blur">
            <div className="flex items-center gap-2">
              <CircleHelp className="size-4 text-[var(--box-open)]" />
              <span className="text-sm font-medium">
                {sel.origin === "label"
                  ? "Ist dieses Label richtig?"
                  : mode === "audit"
                    ? "Fehlt hier ein Fahrzeug-Label?"
                    : "Ist das ein Fahrzeug?"}
              </span>
              {questionNo > 0 && (
                <span className="text-muted-foreground text-xs">
                  Frage {questionNo} von {open.length}
                </span>
              )}
              {typeof sel.claude === "string" && sel.claude && (
                <Badge variant="outline">Claude: {sel.claude}</Badge>
              )}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => answer("car")}
              >
                <Car /> Auto
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => answer("large_vehicle")}
              >
                <Truck /> Groß
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => answer("no")}
              >
                <X /> Kein Fahrzeug
              </Button>
              <Separator orientation="vertical" className="mx-1 h-5" />
              <Button size="sm" variant="ghost" onClick={nextQuestion}>
                Überspringen
              </Button>
              <Button size="sm" variant="ghost" onClick={acceptAllOpen}>
                Alle {open.length} annehmen
              </Button>
            </div>
          </div>
        )}
        {!tile && (
          <div className="text-muted-foreground absolute inset-0 grid place-items-center text-sm">
            <LoaderCircle className="size-5 animate-spin" />
          </div>
        )}
      </div>

      {/* footer */}
      <div className="bg-card flex items-center gap-3 border-t px-3 py-2 text-sm">
        <Button
          size="sm"
          variant="ghost"
          disabled={!hasPrev}
          onClick={() => onNavigate(-1)}
        >
          <ChevronLeft /> Zurück
        </Button>
        <div className="min-w-0">
          <div className="truncate font-mono text-xs">{stem}</div>
          <div className="text-muted-foreground text-xs">
            {position}
            {tile?.done ? " · fertig" : ""}
          </div>
        </div>
        <div className="hidden items-center gap-3 text-xs tabular-nums xl:flex">
          <Legend color={COLORS.car} label={`${c.accepted} Fahrzeuge`} />
          <Legend color={COLORS.open} label={`${c.open} offen`} dashed />
          <Legend color={COLORS.no} label={`${c.rejected} abgelehnt`} dashed />
        </div>
        <div className="flex-1" />
        {c.open > 0 && !(sel && selState === "open") && (
          <Button size="sm" variant="outline" onClick={nextQuestion}>
            <CircleHelp /> {c.open} offene Fragen
          </Button>
        )}
        <span className="text-muted-foreground hidden text-xs whitespace-nowrap lg:inline">
          {saving ? "Speichert…" : dirty ? "Ungespeichert" : "Gespeichert"}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || saving || locked}
          onClick={() => void save(false)}
        >
          <Save /> Speichern
        </Button>
        <Button
          size="sm"
          disabled={saving || locked || !tile}
          onClick={() => void finish()}
        >
          <Check /> Kachel fertig {hasNext && <ChevronRight />}
        </Button>
      </div>
    </div>
  );
}

function ToolItem({
  value,
  label,
  keyHint,
  children,
}: {
  value: string;
  label: string;
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
        </ToggleGroupItem>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {keyHint && (
          <span className="text-muted-foreground ml-2">{keyHint}</span>
        )}
      </TooltipContent>
    </Tooltip>
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
        {keyHint && (
          <span className="text-muted-foreground ml-2">{keyHint}</span>
        )}
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
