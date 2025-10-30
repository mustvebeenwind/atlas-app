import React, { useRef, useState, useEffect } from "react";

/**
 * AtlaS – React Image Canvas (pure JSX)
 * Floors can be composed from rectangles; when you stop selecting or switch tools,
 * overlapping/touching floor rectangles form draggable "floor figures".
 * Double-click a figure to explode back into editable rectangles.
 * Shift-drag a figure handle for uniform (aspect-locked) scaling.
 * + / − buttons scale ONLY overlays (objects you placed). Background stays the same.
 * Pinch/ctrl+wheel zoom affects background image only.
 */

/* ===== Yeat-ish bell synth ===== */
function playYeatBell(ctx, { gain = 0.9, pitch = 880 } = {}) {
  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = gain;
  master.connect(ctx.destination);

  const carrier = ctx.createOscillator();
  carrier.type = "sine";
  carrier.frequency.setValueAtTime(pitch, t);

  const mod = ctx.createOscillator();
  mod.type = "sine";
  mod.frequency.setValueAtTime(pitch / 4, t);

  const modDepth = ctx.createGain();
  modDepth.gain.setValueAtTime(520, t);
  mod.connect(modDepth).connect(carrier.frequency);

  const partial = ctx.createOscillator();
  partial.type = "triangle";
  partial.frequency.setValueAtTime(pitch * 1.5, t);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(1.0, t + 0.007);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);

  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  env.connect(splitter);
  const dl = ctx.createDelay();
  const dr = ctx.createDelay();
  dl.delayTime.value = 0.008;
  dr.delayTime.value = 0.011;
  splitter.connect(dl, 0);
  splitter.connect(dr, 1);
  dl.connect(merger, 0, 0);
  dr.connect(merger, 0, 1);
  merger.connect(master);

  carrier.connect(env);
  partial.connect(env);
  const stopAt = t + 1.0;
  carrier.start(t);
  mod.start(t);
  partial.start(t);
  carrier.stop(stopAt);
  mod.stop(stopAt);
  partial.stop(stopAt);
}
function ensureAudioContext(ref) {
  if (!ref.current) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ref.current = new AC();
  }
  if (ref.current.state === "suspended") {
    ref.current.resume().catch(() => {});
  }
  return ref.current;
}

/* ===== tiny utils ===== */
const isPlainObject = (x) =>
  !!x &&
  typeof x === "object" &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const merge = (o, p) => ({ ...(isPlainObject(o) ? o : {}), ...(isPlainObject(p) ? p : {}) });
const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const clone = (v) => {
  if (v === undefined) return [];
  try {
    if (typeof structuredClone === "function") return structuredClone(v);
  } catch {}
  try {
    return JSON.parse(
      JSON.stringify(v, (_k, val) => (typeof val === "function" || val === undefined ? null : val))
    );
  } catch {
    if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" ? { ...x } : x));
    if (v && typeof v === "object") return { ...v };
    return v;
  }
};
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const round = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
const fitWithin = (w, h, maxW, maxH) => {
  const W = num(w), H = num(h), MW = num(maxW), MH = num(maxH);
  if (W <= 0 || H <= 0 || MW <= 0 || MH <= 0) return { w: 0, h: 0 };
  const r = Math.min(MW / W, MH / H);
  const out = { w: Math.round(W * r), h: Math.round(H * r) };
  if (!Number.isFinite(out.w) || !Number.isFinite(out.h)) return { w: 0, h: 0 };
  return out;
};
const isSquareish = (w, h) => {
  const W = num(w), H = num(h);
  if (W <= 0 || H <= 0) return false;
  const r = W / H;
  return r > 0.9 && r < 1.1;
};
const normRect = (fx0, fy0, fx1, fy1) => {
  const x0 = clamp01(Math.min(fx0, fx1)), y0 = clamp01(Math.min(fy0, fy1));
  const x1 = clamp01(Math.max(fx0, fx1)), y1 = clamp01(Math.max(fy0, fy1));
  return { fx: x0, fy: y0, fw: clamp01(x1 - x0), fh: clamp01(y1 - y0) };
};

/* ===== icons ===== */
const stroke = "#333";
const S = { fill: "none", stroke, strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" };
const Icon = {
  bed: (s = 48) => (
    <svg width={s} height={s} viewBox="0 0 64 64" role="img" aria-label="bed">
      <rect x="6" y="30" width="52" height="18" rx="3" {...S} />
      <rect x="10" y="24" width="22" height="10" rx="2" {...S} />
      <line x1="6" y1="48" x2="6" y2="54" {...S} />
      <line x1="58" y1="48" x2="58" y2="54" {...S} />
    </svg>
  ),
  door: (s = 48) => (
    <svg width={s} height={s} viewBox="0 0 64 64" role="img" aria-label="door">
      <rect x="18" y="6" width="28" height="52" rx="2" {...S} />
      <circle cx="40" cy="32" r="2.5" stroke={stroke} fill={stroke} />
    </svg>
  ),
  table: (s = 48) => (
    <svg width={s} height={s} viewBox="0 0 64 64" role="img" aria-label="table">
      <rect x="10" y="22" width="44" height="8" rx="2" {...S} />
      <line x1="18" y1="30" x2="18" y2="50" {...S} />
      <line x1="46" y1="30" x2="46" y2="50" {...S} />
    </svg>
  ),
  chair: (s = 48) => (
    <svg width={s} height={s} viewBox="0 0 64 64" role="img" aria-label="chair">
      <rect x="22" y="14" width="20" height="14" rx="2" {...S} />
      <rect x="22" y="28" width="20" height="8" rx="2" />
      <line x1="24" y1="36" x2="24" y2="50" {...S} />
      <line x1="40" y1="36" x2="40" y2="50" {...S} />
    </svg>
  ),
};
const PALETTE = ["bed", "door", "table", "chair"].map((t) => ({
  type: t,
  label: t[0].toUpperCase() + t.slice(1),
}));
let idCounter = 1;
const nextId = () => `item_${idCounter++}`;

/* ===== styles ===== */
const styles = {
  app: {
    width: "100vw",
    height: "100vh",
    background: "#faf9f5",
    color: "#333",
    fontFamily: "Inter, system-ui, Arial, sans-serif",
    position: "relative",
    userSelect: "none",
  },
  sidebar: (open) => ({
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: 180,
    background: "#faf9f5",
    borderRight: "1px solid rgba(0,0,0,.1)",
    transform: `translateX(${open ? 0 : -180}px)`,
    transition: "transform .25s, opacity .2s",
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    zIndex: 20,
    opacity: open ? 1 : 0,
    pointerEvents: open ? "auto" : "none",
  }),
  paletteCard: {
    background: "transparent",
    border: "1px solid rgba(0,0,0,.1)",
    borderRadius: 12,
    padding: 10,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    cursor: "grab",
    textAlign: "center",
  },
  floaterBar: { position: "absolute", top: 12, right: 12, display: "flex", gap: 8, zIndex: 40 },
  floaterBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    background: "rgba(0,0,0,0)",
    border: "1px solid rgba(0,0,0,0.2)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  toggleHandle: {
    position: "absolute",
    top: "50%",
    left: 0,
    transform: "translate(-50%,-50%)",
    width: 28,
    height: 64,
    borderRadius: 14,
    background: "rgba(0,0,0,0.08)",
    border: "1px solid rgba(0,0,0,0.15)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    color: "#111",
    zIndex: 30,
  },
  placed: { position: "absolute", touchAction: "none", userSelect: "none", cursor: "grab", zIndex: 10, outline: "none" },
  topChooseBtn: {
    fontSize: 14,
    cursor: "pointer",
    background: "transparent",
    color: "#666",
    border: "1px solid rgba(0,0,0,0.2)",
    padding: "10px 14px",
    borderRadius: 10,
    lineHeight: 1.2,
  },
  undoRedoBar: { position: "absolute", left: "50%", bottom: 16, transform: "translateX(-50%)", display: "flex", gap: 10, zIndex: 45 },
  undoRedoBtn: (ena) => ({
    minWidth: 72,
    height: 40,
    padding: "0 14px",
    borderRadius: 10,
    background: "rgba(0,0,0,0.03)",
    border: `1px solid rgba(0,0,0,${ena ? 0.25 : 0.12})`,
    color: ena ? "#222" : "#999",
    cursor: ena ? "pointer" : "not-allowed",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontSize: 14,
  }),
  stack: { position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", zIndex: 46, width: 160, display: "flex", flexDirection: "column", gap: 8 },
  selectBtn: (open) => ({
    width: "100%",
    minHeight: 44,
    borderRadius: 14,
    border: "1px solid rgba(0,0,0,0.2)",
    background: open ? "#fff" : "rgba(0,0,0,0.02)",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "center",
    fontSize: 12,
    color: "#333",
  }),
  header: (open) => ({ padding: 8, textAlign: "center", fontWeight: 700, borderBottom: open ? "1px solid rgba(0,0,0,0.1)" : "none" }),
  menu: { display: "flex", flexDirection: "column", gap: 6, padding: 8 },
  item: (active, color) => ({
    padding: "8px 10px",
    borderRadius: 10,
    border: `1px solid ${active ? color : "rgba(0,0,0,0.15)"}`,
    background: active ? `${color}22` : "transparent",
    cursor: "pointer",
    textAlign: "center",
    fontWeight: 600,
  }),
  stopBtn: { width: "100%", minHeight: 40, borderRadius: 12, border: "1px solid rgba(0,0,0,0.2)", background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 },
  rect: (b, s) => ({ position: "absolute", background: b, border: `2px solid ${s}`, borderRadius: 0, pointerEvents: "auto", cursor: "move" }),
  draft: (b, s) => ({ position: "absolute", background: b, border: `2px dashed ${s}`, borderRadius: 0, pointerEvents: "none" }),
  resizeHandle: (color) => ({
    position: "absolute",
    width: 8,
    height: 8,
    background: "#fff",
    border: `2px solid ${color}`,
    borderRadius: 3,
    boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
    zIndex: 3,
    touchAction: "none",
  }),
  note: {
    position: "absolute",
    left: "50%",
    bottom: 64,
    transform: "translateX(-50%)",
    background: "#fff",
    border: "1px solid rgba(0,0,0,0.15)",
    borderRadius: 10,
    padding: "8px 12px",
    fontSize: 13,
    color: "#0a0a0a",
    boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
    zIndex: 48,
  },
  windowTag: {
    position: "absolute",
    transform: "translateY(-110%)",
    background: "#fff",
    border: "1px solid rgba(0,0,0,0.15)",
    borderRadius: 8,
    padding: "3px 6px",
    fontSize: 11,
    lineHeight: 1.2,
    color: "#064",
    boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
    pointerEvents: "auto",
    cursor: "pointer",
    zIndex: 12,
    whiteSpace: "nowrap",
  },
};

const COLORS = {
  wall: { fill: "rgba(255,77,166,0.35)", stroke: "rgba(255,77,166,0.85)" },
  window: { fill: "rgba(0,160,80,0.35)", stroke: "rgba(0,160,80,0.85)" },
  floor: { fill: "rgba(10,40,160,0.35)", stroke: "rgba(10,40,160,0.9)" },
};

const getCanvasRect = (el) => {
  if (!el) return { left: 0, top: 0, width: 0, height: 0 };
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

export default function ImageCanvasApp() {
  /* pan/zoom + BG */
  const [bgPan, setBgPan] = useState({ x: 0, y: 0 });
  const [bgUrl, setBgUrl] = useState(null);
  const lastBgUrlRef = useRef(null);
  // overlayScale: scale overlays only; scale: background scale
  const [bgSize, setBgSize] = useState({ baseW: 0, baseH: 0, naturalW: 0, naturalH: 0, scale: 1, overlayScale: 1 });

  /* items */
  const [items, setItems] = useState([]);

  /* layers */
  const [walls, setWalls] = useState([]);
  const [windows, setWindows] = useState([]);
  const [floors, setFloors] = useState([]); // live floor rects
  const [floorFigures, setFloorFigures] = useState([]); // finalized figures

  /* drawing/selecting */
  const [activeTool, setActiveTool] = useState(null);
  const [selecting, setSelecting] = useState(false);
  const [draft, setDraft] = useState(null);
  const [selectOpen, setSelectOpen] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [, forceResizeTick] = useState(0);

  /* window height prompt */
  const [windowPrompt, setWindowPrompt] = useState(null); // { id, value, error }

  /* history */
  const [history, setHistory] = useState([
    { items: [], walls: [], windows: [], floors: [], floorFigures: [], bgUrl: null, bgSize: { baseW: 0, baseH: 0, naturalW: 0, naturalH: 0, scale: 1, overlayScale: 1 } },
  ]);
  const [hIndex, setHIndex] = useState(0);
  const canUndo = hIndex > 0,
    canRedo = hIndex < history.length - 1;

  /* refs */
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const draggingRef = useRef({ id: null, offsetFx: 0, offsetFy: 0 });
  const resizingRef = useRef({ id: null, startSize: 0, startX: 0, startY: 0 });
  const dragStartSnapshotRef = useRef(null);
  const wheelTimerRef = useRef(null);
  const panDragRef = useRef({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 });
  const pointersRef = useRef(new Map());

  /* shape refs */
  const shapeDraggingRef = useRef({ kind: null, id: null, offsetFx: 0, offsetFy: 0, fw: 0, fh: 0, start: null });
  const shapeResizingRef = useRef({ kind: null, id: null, handle: null, start: null, startLayer: null });

  /* figure selection & drag/resize */
  const [selectedFigureId, setSelectedFigureId] = useState(null);
  const figureDragRef = useRef({ id: null, startRects: null, startX: 0, startY: 0 });
  const figureResizeRef = useRef({ id: null, handle: null, startBBox: null, startRects: null, startX: 0, startY: 0 });

  /* audio */
  const audioCtxRef = useRef(null);
  const bellPlayedRef = useRef(false);
  useEffect(() => {
    try {
      const ctx = ensureAudioContext(audioCtxRef);
      playYeatBell(ctx);
      bellPlayedRef.current = true;
    } catch {}
    const unlock = () => {
      if (bellPlayedRef.current) return;
      const ctx = ensureAudioContext(audioCtxRef);
      playYeatBell(ctx);
      bellPlayedRef.current = true;
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  /* snapshots */
  const snapshotState = (
    nextItems = items,
    nextBgUrl = bgUrl,
    nextBgSize = bgSize,
    nextWalls = walls,
    nextWindows = windows,
    nextFloors = floors,
    nextFloorFigures = floorFigures
  ) => {
    setHistory((prev) => {
      const trimmed = prev.slice(0, hIndex + 1);
      const snap = {
        items: clone(nextItems),
        walls: clone(nextWalls),
        windows: clone(nextWindows),
        floors: clone(nextFloors),
        floorFigures: clone(nextFloorFigures),
        bgUrl: nextBgUrl,
        bgSize: { ...nextBgSize },
      };
      const newHist = [...trimmed, snap];
      setHIndex(newHist.length - 1);
      return newHist;
    });
    setItems(nextItems);
    setWalls(nextWalls);
    setWindows(nextWindows);
    setFloors(nextFloors);
    setFloorFigures(nextFloorFigures);
    setBgUrl(nextBgUrl);
    setBgSize(nextBgSize);
  };
  const snapshotItems = (next) => snapshotState(next, bgUrl, bgSize, walls, windows, floors, floorFigures);
  const snapshotLayer = (k, next) => {
    if (k === "wall") snapshotState(items, bgUrl, bgSize, next, windows, floors, floorFigures);
    else if (k === "window") snapshotState(items, bgUrl, bgSize, walls, next, floors, floorFigures);
    else snapshotState(items, bgUrl, bgSize, walls, windows, next, floorFigures);
  };

  /* frames */
  const getDisplayDims = () => ({
    dispW: Math.max(0, round(num(bgSize.baseW) * num(bgSize.scale, 1))),
    dispH: Math.max(0, round(num(bgSize.baseH) * num(bgSize.scale, 1))),
  });
  const getBgFrame = () => {
    const el = canvasRef.current;
    const { width: cw, height: ch, left, top } = getCanvasRect(el);
    const { dispW, dispH } = getDisplayDims();
    const dx = Math.floor((cw - dispW) / 2) + Math.round(num(bgPan.x));
    const dy = Math.floor((ch - dispH) / 2) + Math.round(num(bgPan.y));
    return { dx, dy, left, top, cw, ch, dispW, dispH };
  };
  const getRefFrame = () => {
    const f = getBgFrame();
    return {
      left: f.left,
      top: f.top,
      refW: f.cw,
      refH: f.ch,
      cw: f.cw,
      ch: f.ch,
      bgDx: f.dx,
      bgDy: f.dy,
      dispW: f.dispW,
      dispH: f.dispH,
    };
  };
  // IMPORTANT: map to overlay coordinates (scaled by overlayScale)
  const getRel = (x, y) => {
    const { left, top, bgDx, bgDy, dispW, dispH, refW, refH } = getRefFrame();
    const ov = Math.max(0.0001, num(bgSize.overlayScale, 1));
    return {
      fx: clamp01((x - (left + bgDx)) / Math.max(1, dispW * ov)),
      fy: clamp01((y - (top + bgDy)) / Math.max(1, dispH * ov)),
      refW,
      refH,
      bgDx,
      bgDy,
      dispW,
      dispH,
    };
  };

  /* upload */
  const onFile = (file) => {
    if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const naturalW = num(img.width),
          naturalH = num(img.height);
        const base = isSquareish(naturalW, naturalH) ? { w: 300, h: 300 } : fitWithin(naturalW, naturalH, 500, 1000);
        const baseW = base.w > 0 ? base.w : 300,
          baseH = base.h > 0 ? base.h : 300;
        if (lastBgUrlRef.current && lastBgUrlRef.current !== url) {
          try {
            URL.revokeObjectURL(lastBgUrlRef.current);
          } catch {}
        }
        lastBgUrlRef.current = url;
        snapshotState(items, url, { baseW, baseH, naturalW, naturalH, scale: 1, overlayScale: 1 }, walls, windows, floors, floorFigures);
      };
      img.src = url;
    } catch {}
  };
  const onInputChange = (e) => {
    const f = e?.target?.files?.[0];
    if (!f) return;
    onFile(f);
    try {
      e.target.value = "";
    } catch {}
  };

  /* DnD */
  const onPaletteDragStart = (e, type) => {
    if (!e?.dataTransfer) return;
    try {
      e.dataTransfer.setData("text/plain", type);
      e.dataTransfer.setData("text", type);
    } catch {}
    e.dataTransfer.effectAllowed = "copyMove";
    if (e.dataTransfer.setDragImage && e.currentTarget) {
      try {
        e.dataTransfer.setDragImage(e.currentTarget, e.currentTarget.clientWidth / 2, e.currentTarget.clientHeight / 2);
      } catch {}
    }
  };
  const onCanvasDragOver = (e) => {
    if (!e) return;
    e.preventDefault();
    try {
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    } catch {}
  };
  const dropOnCanvas = (x, y, type) => {
    const { fx, fy } = getRel(x, y);
    snapshotItems([...items, { id: nextId(), type, fx, fy, size: 48 }]);
  };
  const onCanvasDrop = (e) => {
    e.preventDefault();
    const dt = e.dataTransfer;
    if (dt?.files?.length > 0) {
      const f = dt.files[0];
      if (f?.type?.startsWith("image/")) onFile(f);
      return;
    }
    const type = dt.getData("text/plain") || dt.getData("text");
    if (type) dropOnCanvas(e.clientX, e.clientY, type);
  };

  /* layer utils */
  const getLayer = (k) => (k === "wall" ? walls : k === "window" ? windows : floors);
  const setLayer = (k, updater) => {
    if (k === "wall") setWalls(updater);
    else if (k === "window") setWindows(updater);
    else setFloors(updater);
  };
  const colorFor = (k) => (k === "wall" ? "#ff4da6" : k === "window" ? "#00a050" : "#0a28a0");

  /* floor grouping */
  const rectEdges = (r) => {
    const L = clamp01(num(r.fx)),
      T = clamp01(num(r.fy));
    const R = clamp01(num(r.fx) + num(r.fw)),
      B = clamp01(num(r.fy) + num(r.fh));
    return { L: Math.min(L, R), T: Math.min(T, B), R: Math.max(L, R), B: Math.max(T, B) };
  };
  const rectsTouchOrOverlap = (a, b) => {
    const A = rectEdges(a),
      B = rectEdges(b);
    const x = !(A.R < B.L || B.R < A.L);
    const y = !(A.B < B.T || B.B < A.T);
    return x && y;
  };
  const groupRects = (rects) => {
    const n = rects.length;
    const seen = new Array(n).fill(false);
    const groups = [];
    for (let i = 0; i < n; i++) {
      if (seen[i]) continue;
      seen[i] = true;
      const g = [rects[i]];
      const q = [i];
      while (q.length) {
        const k = q.pop();
        for (let j = 0; j < n; j++) {
          if (seen[j]) continue;
          if (rectsTouchOrOverlap(rects[k], rects[j])) {
            seen[j] = true;
            g.push(rects[j]);
            q.push(j);
          }
        }
      }
      groups.push(g);
    }
    return groups;
  };
  const finalizeFloorsToFigures = () => {
    if (!floors.length) return;
    const groups = groupRects(floors);
    const newFigs = groups.map((rects) => ({
      id: `floorFig_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      rects: clone(rects),
    }));
    snapshotState(items, bgUrl, bgSize, walls, windows, [], [...floorFigures, ...newFigs]);
  };

  /* select menu */
  const toggleSelect = () => setSelectOpen((v) => !v);
  const chooseTool = (k) => {
    if (activeTool === "floor" && floors.length) finalizeFloorsToFigures();
    setActiveTool(k);
    setSelectOpen(false);
    setDraft(null);
    setSelecting(true);
  };
  const stopSelecting = () => {
    setSelecting(false);
    setDraft(null);
    if (activeTool === "floor") finalizeFloorsToFigures();
  };

  /* window prompt */
  const submitWindowHeight = (e) => {
    e?.preventDefault?.();
    if (!windowPrompt) return;
    const raw = (windowPrompt.value ?? "").toString().trim().replace(",", ".");
    const val = Number(raw);
    if (!Number.isFinite(val) || val < 0) {
      setWindowPrompt((p) => ({ ...(p || {}), error: "Please enter a non-negative number (cm)." }));
      return;
    }
    setWindows((prev) => {
      const next = prev.map((w) => (w.id === windowPrompt.id ? { ...w, heightCm: val } : w));
      snapshotLayer("window", next);
      return next;
    });
    setWindowPrompt(null);
  };
  const onChangeWindowHeight = (e) => setWindowPrompt((p) => (p ? { ...p, value: e.target.value, error: "" } : p));
  const openWindowPrompt = (id, initialValue) => {
    const val = typeof initialValue === "number" && Number.isFinite(initialValue) ? String(initialValue) : "";
    setWindowPrompt({ id, value: val, error: "" });
  };

  /* create rectangles (click start → click end) */
  const handleCanvasClick = (e) => {
    if (!activeTool || !selecting) {
      setSelectedFigureId(null);
      return;
    }
    const { fx, fy } = getRel(e.clientX, e.clientY);
    if (!draft) {
      setDraft({ start: { fx, fy }, end: { fx, fy } });
      return;
    }
    const r = normRect(draft.start.fx, draft.start.fy, fx, fy);
    const id = `${activeTool}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const next = [...getLayer(activeTool), { id, ...r }];
    setDraft(null);
    snapshotLayer(activeTool, next);
    if (activeTool === "window") setWindowPrompt({ id, value: "", error: "" });
  };

  /* items drag/resize */
  const onItemPointerDown = (e, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const { fx, fy } = getRel(e.clientX, e.clientY);
    const it = items.find((x) => x.id === id);
    if (!it) return;
    draggingRef.current = { id, offsetFx: fx - (it.fx || 0), offsetFy: fy - (it.fy || 0) };
    dragStartSnapshotRef.current = clone(items);
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  };
  const onItemResizePointerDown = (e, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const it = items.find((x) => x.id === id);
    if (!it) return;
    resizingRef.current = { id, startSize: Math.max(16, it.size || 48), startX: e.clientX, startY: e.clientY };
    dragStartSnapshotRef.current = clone(items);
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  };

  /* shapes drag/resize */
  const onShapeBodyPointerDown = (e, k, id) => {
    if (e.button !== 0) return;
    const { fx, fy } = getRel(e.clientX, e.clientY);
    const r = getLayer(k).find((x) => x.id === id);
    if (!r) return;
    shapeDraggingRef.current = { kind: k, id, offsetFx: fx - (r.fx || 0), offsetFy: fy - (r.fy || 0), fw: r.fw || 0, fh: r.fh || 0, start: clone(getLayer(k)) };
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  };
  const onShapeHandlePointerDown = (e, k, id, handle) => {
    if (!selecting) return;
    e.stopPropagation();
    const r = getLayer(k).find((x) => x.id === id);
    if (!r) return;
    shapeResizingRef.current = { kind: k, id, handle, start: { ...r }, startLayer: clone(getLayer(k)) };
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  };

  /* figure drag */
  const onFigurePointerDown = (e, figId) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const fig = floorFigures.find((f) => f.id === figId);
    if (!fig) return;
    setSelectedFigureId(figId);
    figureDragRef.current = { id: figId, startRects: clone(fig.rects), startX: e.clientX, startY: e.clientY };
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  };

  /* figure bbox helpers & uniform scaling */
  const figBBox = (rects) => {
    const xs = rects.map((r) => [num(r.fx), num(r.fx) + num(r.fw)]).flat();
    const ys = rects.map((r) => [num(r.fy), num(r.fy) + num(r.fh)]).flat();
    const L = Math.max(0, Math.min(...xs)),
      R = Math.min(1, Math.max(...xs));
    const T = Math.max(0, Math.min(...ys)),
      B = Math.min(1, Math.max(...ys));
    return { L, T, R, B, W: R - L, H: B - T };
  };
  const scaleRectsFromBBox = (rects, start, next) => {
    const sx = Math.max(0.001, (next.R - next.L) / Math.max(0.001, start.R - start.L));
    const sy = Math.max(0.001, (next.B - next.T) / Math.max(0.001, start.B - start.T));
    return rects.map((r) => {
      const fx0 = num(r.fx),
        fy0 = num(r.fy),
        fw0 = num(r.fw),
        fh0 = num(r.fh);
      const relX = fx0 - start.L;
      const relY = fy0 - start.T;
      const nfx = next.L + relX * sx;
      const nfy = next.T + relY * sy;
      const nfw = fw0 * sx;
      const nfh = fh0 * sy;
      return { ...r, fx: clamp01(nfx), fy: clamp01(nfy), fw: clamp01(nfw), fh: clamp01(nfh) };
    });
  };
  const onFigureHandlePointerDown = (e, figId, handle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const fig = floorFigures.find((f) => f.id === figId);
    if (!fig) return;
    const bb = figBBox(fig.rects);
    setSelectedFigureId(figId);
    figureResizeRef.current = {
      id: figId,
      handle,
      startBBox: { L: bb.L, T: bb.T, R: bb.R, B: bb.B },
      startRects: clone(fig.rects),
      startX: e.clientX,
      startY: e.clientY,
    };
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  };

  /* pointer move / pan / pinch */
  const MIN_SIDE = 0.005;
  const onCanvasPointerMove = (e) => {
    // figure resize first
    const fr = figureResizeRef.current;
    if (fr.id) {
      const idx = floorFigures.findIndex((f) => f.id === fr.id);
      if (idx !== -1) {
        const { dispW, dispH } = getRefFrame();
        // because overlay is scaled, getRel uses overlayScale; here we work in normalized space, so dx/dy map to dispW/dispH
        const dx = (e.clientX - fr.startX) / Math.max(1, dispW * num(bgSize.overlayScale, 1));
        const dy = (e.clientY - fr.startY) / Math.max(1, dispH * num(bgSize.overlayScale, 1));
        const s = fr.startBBox;
        let L = s.L, T = s.T, R = s.R, B = s.B;
        const minSize = 0.01;
        const move = {
          nw: () => { L = clamp01(s.L + dx); T = clamp01(s.T + dy); },
          ne: () => { R = clamp01(s.R + dx); T = clamp01(s.T + dy); },
          sw: () => { L = clamp01(s.L + dx); B = clamp01(s.B + dy); },
          se: () => { R = clamp01(s.R + dx); B = clamp01(s.B + dy); },
          n:  () => { T = clamp01(s.T + dy); },
          s:  () => { B = clamp01(s.B + dy); },
          w:  () => { L = clamp01(s.L + dx); },
          e:  () => { R = clamp01(s.R + dx); },
        }[fr.handle] || (() => {});
        move();

        // bounds
        L = Math.max(0, Math.min(L, 1)); R = Math.max(0, Math.min(R, 1));
        T = Math.max(0, Math.min(T, 1)); B = Math.max(0, Math.min(B, 1));

        // Uniform scaling with Shift
        if (e.shiftKey) {
          const startW = Math.max(minSize, s.R - s.L);
          const startH = Math.max(minSize, s.B - s.T);
          const ratio = startW / startH;
          let W = Math.max(minSize, R - L);
          let H = Math.max(minSize, B - T);
          const midX = (s.L + s.R) / 2;
          const midY = (s.T + s.B) / 2;

          const corner = (moving) => {
            if (W / H > ratio) {
              const newW = ratio * H, dW = W - newW;
              if (moving.includes("w")) L += dW; else R -= dW;
            } else {
              const newH = W / ratio, dH = H - newH;
              if (moving.includes("n")) T += dH; else B -= dH;
            }
          };
          const edge = (edge) => {
            if (edge === "e" || edge === "w") {
              W = Math.max(minSize, R - L);
              const newH = W / ratio, cy = midY;
              T = cy - newH / 2; B = cy + newH / 2;
            } else {
              H = Math.max(minSize, B - T);
              const newW = H * ratio, cx = midX;
              L = cx - newW / 2; R = cx + newW / 2;
            }
          };
          if (["nw","ne","sw","se"].includes(fr.handle)) corner(fr.handle); else edge(fr.handle);

          L = Math.max(0, Math.min(L, 1)); R = Math.max(0, Math.min(R, 1));
          T = Math.max(0, Math.min(T, 1)); B = Math.max(0, Math.min(B, 1));
        }

        if (R - L < minSize) { if (fr.handle.includes("w")) L = R - minSize; else R = L + minSize; }
        if (B - T < minSize) { if (fr.handle.includes("n")) T = B - minSize; else B = T + minSize; }

        const nextBBox = { L: Math.min(L, R), T: Math.min(T, B), R: Math.max(L, R), B: Math.max(T, B) };
        const newRects = scaleRectsFromBBox(fr.startRects, fr.startBBox, nextBBox);
        setFloorFigures((prev) => prev.map((f, i) => (i === idx ? { ...f, rects: newRects } : f)));
      }
      return;
    }

    // figure drag
    const fd = figureDragRef.current;
    if (fd.id) {
      const figIdx = floorFigures.findIndex((f) => f.id === fd.id);
      if (figIdx !== -1) {
        const { dispW, dispH } = getRefFrame();
        const ov = Math.max(0.0001, num(bgSize.overlayScale, 1));
        const dxPx = (e.clientX - fd.startX), dyPx = (e.clientY - fd.startY);
        let dx = dxPx / Math.max(1, dispW * ov), dy = dyPx / Math.max(1, dispH * ov);
        const fig = { rects: fd.startRects };
        const minFx = Math.min(...fig.rects.map((r) => num(r.fx)));
        const minFy = Math.min(...fig.rects.map((r) => num(r.fy)));
        const maxR = Math.max(...fig.rects.map((r) => num(r.fx) + num(r.fw)));
        const maxB = Math.max(...fig.rects.map((r) => num(r.fy) + num(r.fh)));
        dx = Math.max(-minFx, Math.min(1 - maxR, dx));
        dy = Math.max(-minFy, Math.min(1 - maxB, dy));
        const movedRects = fig.rects.map((r) => ({ ...r, fx: clamp01(num(r.fx) + dx), fy: clamp01(num(r.fy) + dy) }));
        setFloorFigures((prev) => prev.map((f, i) => (i === figIdx ? { ...f, rects: movedRects } : f)));
      }
      return;
    }

    // shape resize
    const rs = shapeResizingRef.current;
    if (rs.id) {
      const { fx, fy } = getRel(e.clientX, e.clientY);
      const s = rs.start;
      let L = s.fx, T = s.fy, R = s.fx + s.fw, B = s.fy + s.fh;
      const ce = (v) => clamp01(num(v));
      ({
        nw: () => { L = ce(fx); T = ce(fy); },
        ne: () => { R = ce(fx); T = ce(fy); },
        sw: () => { L = ce(fx); B = ce(fy); },
        se: () => { R = ce(fx); B = ce(fy); },
        n:  () => { T = ce(fy); },
        s:  () => { B = ce(fy); },
        w:  () => { L = ce(fx); },
        e:  () => { R = ce(fx); },
      }[rs.handle] || (() => {}))();
      L = Math.max(0, Math.min(L, 1)); R = Math.max(0, Math.min(R, 1));
      T = Math.max(0, Math.min(T, 1)); B = Math.max(0, Math.min(B, 1));
      if (R - L < MIN_SIDE) { if (rs.handle.includes("w")) L = R - MIN_SIDE; else R = L + MIN_SIDE; }
      if (B - T < MIN_SIDE) { if (rs.handle.includes("n")) T = B - MIN_SIDE; else B = T + MIN_SIDE; }
      const nxt = { fx: Math.min(L, R), fy: Math.min(T, B), fw: Math.abs(R - L), fh: Math.abs(B - T) };
      setLayer(rs.kind, (prev) => prev.map((r) => (r.id === rs.id ? merge(r, nxt) : r)));
      return;
    }

    // item resize
    const rsz = resizingRef.current;
    if (rsz.id) {
      const it = items.find((i) => i.id === rsz.id);
      if (!it) return;
      const d = Math.max(e.clientX - rsz.startX, e.clientY - rsz.startY);
      const size = Math.max(16, Math.min(256, Math.round(num(rsz.startSize || 48) + d)));
      setItems((p) => p.map((x) => (x.id === rsz.id ? merge(x, { size }) : x)));
      return;
    }

    // shape drag
    const sd = shapeDraggingRef.current;
    if (sd.id) {
      const { fx, fy } = getRel(e.clientX, e.clientY);
      let nx = clamp01(num(fx) - num(sd.offsetFx)), ny = clamp01(num(fy) - num(sd.offsetFy));
      nx = Math.max(0, Math.min(1 - num(sd.fw), nx)); ny = Math.max(0, Math.min(1 - num(sd.fh), ny));
      setLayer(sd.kind, (p) => p.map((r) => (r.id === sd.id ? merge(r, { fx: nx, fy: ny }) : r)));
      return;
    }

    // draft preview
    if (activeTool && selecting && draft) {
      const { fx, fy } = getRel(e.clientX, e.clientY);
      setDraft((d) => merge(d, { end: { fx, fy } }));
    }

    // pan
    if (panDragRef.current.active) {
      setBgPan({
        x: num(panDragRef.current.origX) + (e.clientX - panDragRef.current.startX),
        y: num(panDragRef.current.origY) + (e.clientY - panDragRef.current.startY),
      });
      return;
    }

    // pinch (BG zoom only)
    if (e.pointerType === "touch" && pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size === 2) {
        const [p1, p2] = Array.from(pointersRef.current.values());
        const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (!onCanvasPointerMove._lastDist) onCanvasPointerMove._lastDist = dist;
        const factor = dist / onCanvasPointerMove._lastDist;
        if (factor > 0 && !Number.isNaN(factor)) {
          applyZoomAt(midX, midY, factor); // background only
          const prev = onCanvasPointerMove._lastMid || { x: midX, y: midY };
          setBgPan((p) => ({ x: p.x + (midX - prev.x), y: p.y + (midY - prev.y) }));
          onCanvasPointerMove._lastMid = { x: midX, y: midY };
        }
        onCanvasPointerMove._lastDist = dist;
      }
    }
  };

  const onCanvasPointerUp = (e) => {
    // finalize figure resize
    if (figureResizeRef.current.id) {
      const before = figureResizeRef.current.startRects;
      const figId = figureResizeRef.current.id;
      figureResizeRef.current = { id: null, handle: null, startBBox: null, startRects: null, startX: 0, startY: 0 };
      const fig = floorFigures.find((f) => f.id === figId);
      if (fig && JSON.stringify(before) !== JSON.stringify(fig.rects)) {
        snapshotState(items, bgUrl, bgSize, walls, windows, floors, floorFigures);
      }
    }

    // finalize figure drag
    if (figureDragRef.current.id) {
      const before = figureDragRef.current.startRects;
      const figId = figureDragRef.current.id;
      figureDragRef.current = { id: null, startRects: null, startX: 0, startY: 0 };
      const fig = floorFigures.find((f) => f.id === figId);
      if (fig && JSON.stringify(before) !== JSON.stringify(fig.rects)) {
        snapshotState(items, bgUrl, bgSize, walls, windows, floors, floorFigures);
      }
    }

    // finalize resize
    const rs = shapeResizingRef.current;
    if (rs.id) {
      const before = rs.startLayer;
      shapeResizingRef.current = { kind: null, id: null, handle: null, start: null, startLayer: null };
      const after = getLayer(rs.kind);
      if (before && JSON.stringify(before) !== JSON.stringify(after)) snapshotLayer(rs.kind, after);
    }

    // finalize item resize
    const rsz = resizingRef.current;
    if (rsz.id) {
      resizingRef.current = { id: null, startSize: 0, startX: 0, startY: 0 };
      const before = dragStartSnapshotRef.current || [];
      if (JSON.stringify(before) !== JSON.stringify(items)) snapshotItems(items);
      dragStartSnapshotRef.current = null;
    }

    // finalize shape drag
    const sd = shapeDraggingRef.current;
    if (sd.id) {
      const before = sd.start;
      shapeDraggingRef.current = { kind: null, id: null, offsetFx: 0, offsetFy: 0, fw: 0, fh: 0, start: null };
      const after = getLayer(sd.kind);
      if (before && JSON.stringify(before) !== JSON.stringify(after)) snapshotLayer(sd.kind, after);
    }

    // finalize item drag
    const drag = draggingRef.current;
    if (drag.id != null) {
      draggingRef.current = { id: null, offsetFx: 0, offsetFy: 0 };
      const before = dragStartSnapshotRef.current || [];
      if (JSON.stringify(before) !== JSON.stringify(items)) snapshotItems(items);
      dragStartSnapshotRef.current = null;
    }

    if (panDragRef.current.active) {
      panDragRef.current.active = false;
      scheduleBgSnapshot();
    }
    pointersRef.current.delete(e.pointerId);
    onCanvasPointerMove._lastDist = null;
    onCanvasPointerMove._lastMid = null;
  };

  const onCanvasPointerCancel = (e) => {
    pointersRef.current.delete(e.pointerId);
    panDragRef.current.active = false;
    onCanvasPointerMove._lastDist = null;
    onCanvasPointerMove._lastMid = null;
    shapeResizingRef.current = { kind: null, id: null, handle: null, start: null, startLayer: null };
  };
  const onCanvasPointerDown = (e) => {
    if (e.pointerType === "touch") pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const panKey = e.button === 1 || e.buttons === 4 || e.getModifierState?.("Space");
    if (panKey) {
      e.preventDefault();
      panDragRef.current = { active: true, startX: e.clientX, startY: e.clientY, origX: num(bgPan.x), origY: num(bgPan.y) };
    }
  };

  /* zoom */
  const scheduleBgSnapshot = (nextBgSize) => {
    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = setTimeout(() => {
      snapshotState(items, bgUrl, nextBgSize ?? bgSize, walls, windows, floors, floorFigures);
    }, 300);
  };
  // BG zoom (used by wheel/pinch)
  const applyZoomAt = (screenX, screenY, factor) => {
    const f = num(factor, 1);
    setBgSize((s) => {
      const nextScale = Math.min(5, Math.max(0.2, num(s.scale, 1) * f));
      const dispW = num(s.baseW) * num(s.scale, 1), dispH = num(s.baseH) * num(s.scale, 1);
      const { left, top, width: cw, height: ch } = getCanvasRect(canvasRef.current);
      const beforeDx = Math.floor((cw - dispW) / 2) + Math.round(num(bgPan.x));
      const beforeDy = Math.floor((ch - dispH) / 2) + Math.round(num(bgPan.y));
      const offsetX = screenX - (left + beforeDx), offsetY = screenY - (top + beforeDy);
      const scaleRatio = nextScale / num(s.scale, 1);
      setBgPan((p) => ({ x: num(p.x) - offsetX * (scaleRatio - 1), y: num(p.y) - offsetY * (scaleRatio - 1) }));
      const next = { ...s, scale: nextScale };
      scheduleBgSnapshot(next);
      return next;
    });
  };
  const onCanvasWheel = (e) => {
    if (!bgUrl || !(e.shiftKey || e.ctrlKey)) return;
    e.preventDefault();
    const { left, top } = getCanvasRect(canvasRef.current);
    const step = e.shiftKey && e.ctrlKey ? 0.15 : 0.1;
    const factor = 1 + (e.deltaY < 0 ? 1 : -1) * step;
    applyZoomAt(e.clientX - left, e.clientY - top, factor); // BG only
  };
  // +/- buttons → overlays only
  const nudgeZoom = (m) => {
    if (!bgUrl) return;
    setBgSize((s) => {
      const next = { ...s, overlayScale: Math.min(5, Math.max(0.2, num(s.overlayScale, 1) * m)) };
      scheduleBgSnapshot(next);
      return next;
    });
  };

  /* toolbar */
  const clearAll = () => snapshotState([], bgUrl, bgSize, [], [], [], []);
  const removeItem = (id) => snapshotItems(items.filter((it) => it.id !== id));
  const clearBackground = () => {
    const reset = { baseW: 0, baseH: 0, naturalW: 0, naturalH: 0, scale: 1, overlayScale: 1 };
    if (lastBgUrlRef.current) {
      try { URL.revokeObjectURL(lastBgUrlRef.current); } catch {}
      lastBgUrlRef.current = null;
    }
    snapshotState(items, null, reset, walls, windows, floors, floorFigures);
  };

  /* export (BG only zoom; overlays multiplied by overlayScale) */
  async function saveCompositionImage() {
    try {
      if (!canvasRef.current) return;
      const F = getRefFrame();
      const exportOnlyBgArea = Boolean(bgUrl && F.dispW > 0 && F.dispH > 0);
      const outW = exportOnlyBgArea
        ? Math.max(1, round(F.dispW, 1))
        : Math.max(1, Math.floor(canvasRef.current.getBoundingClientRect().width));
      const outH = exportOnlyBgArea
        ? Math.max(1, round(F.dispH, 1))
        : Math.max(1, Math.floor(canvasRef.current.getBoundingClientRect().height));
      const canvas = document.createElement("canvas");
      const dpr = Math.max(1, Math.floor(num(window.devicePixelRatio, 1)));
      canvas.width = outW * dpr;
      canvas.height = outH * dpr;
      canvas.style.width = `${outW}px`;
      canvas.style.height = `${outH}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      if (!exportOnlyBgArea) {
        ctx.fillStyle = "#faf9f5";
        ctx.fillRect(0, 0, outW, outH);
      }
      // background
      if (bgUrl && F.dispW > 0 && F.dispH > 0) {
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const x = exportOnlyBgArea ? 0 : Math.round(num(F.bgDx));
            const y = exportOnlyBgArea ? 0 : Math.round(num(F.bgDy));
            ctx.drawImage(img, x, y, round(F.dispW, 1), round(F.dispH, 1));
            resolve();
          };
          img.onerror = resolve;
          img.src = bgUrl;
        });
      }
      // overlays scaled by overlayScale
      const ov = Math.max(0.0001, num(bgSize.overlayScale, 1));
      const drawRects = (list, color) => {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        for (const r of list) {
          const leftPx = round(F.bgDx + num(r.fx) * F.dispW * ov);
          const topPx = round(F.bgDy + num(r.fy) * F.dispH * ov);
          const wPx = round(num(r.fw) * F.dispW * ov);
          const hPx = round(num(r.fh) * F.dispH * ov);
          const drawX = exportOnlyBgArea ? leftPx - round(num(F.bgDx)) : leftPx;
          const drawY = exportOnlyBgArea ? topPx - round(num(F.bgDy)) : topPx;
          ctx.fillRect(drawX, drawY, wPx, hPx);
          ctx.strokeRect(drawX, drawY, wPx, hPx);
        }
        ctx.restore();
      };
      drawRects(floors, "#0a28a0");
      for (const fig of floorFigures) drawRects(fig.rects, "#0a28a0");
      drawRects(walls, "#ff4da6");
      drawRects(windows, "#00a050");

      // items
      for (const it of items) {
        const node = document.getElementById(it.id);
        if (!node) continue;
        const svg = node.querySelector("svg");
        if (!svg) continue;
        const left0 = round(F.bgDx + num(it.fx) * F.dispW * ov);
        const top0 = round(F.bgDy + num(it.fy) * F.dispH * ov);
        const left = exportOnlyBgArea ? left0 - round(num(F.bgDx)) : left0;
        const top = exportOnlyBgArea ? top0 - round(num(F.bgDy)) : top0;
        const cloneSvg = svg.cloneNode(true);
        const svgStr = new XMLSerializer().serializeToString(cloneSvg);
        const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const baseSize = Math.max(16, Math.min(256, num(it.size || 48)));
        const sizePx = Math.round(baseSize * ov);
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, left, top, sizePx, sizePx);
            URL.revokeObjectURL(url);
            resolve();
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          img.src = url;
        });
      }

      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = exportOnlyBgArea ? "composition-transparent.png" : "composition.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error("saveCompositionImage failed", err);
      alert("Could not save the composition image.");
    }
  }

  /* undo/redo */
  const undo = () => {
    if (!canUndo) return;
    const i = hIndex - 1;
    setHIndex(i);
    const s = history[i];
    setItems(clone(s.items));
    setWalls(clone(s.walls || []));
    setWindows(clone(s.windows || []));
    setFloors(clone(s.floors || []));
    setFloorFigures(clone(s.floorFigures || []));
    setBgUrl(s.bgUrl);
    setBgSize({ ...s.bgSize });
  };
  const redo = () => {
    if (!canRedo) return;
    const i = hIndex + 1;
    setHIndex(i);
    const s = history[i];
    setItems(clone(s.items));
    setWalls(clone(s.walls || []));
    setWindows(clone(s.windows || []));
    setFloors(clone(s.floors || []));
    setFloorFigures(clone(s.floorFigures || []));
    setBgUrl(s.bgUrl);
    setBgSize({ ...s.bgSize });
  };

  /* shortcuts + resize */
  const undoRef = useRef(undo), redoRef = useRef(redo);
  useEffect(() => { undoRef.current = undo; redoRef.current = redo; });
  useEffect(() => {
    const onKeyDown = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undoRef.current(); }
      else if (k === "z" && e.shiftKey) { e.preventDefault(); redoRef.current(); }
      else if (k === "y") { e.preventDefault(); redoRef.current(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    const onResize = () => forceResizeTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const defocusActive = () => {
    const ae = document.activeElement;
    if (ae && typeof ae.blur === "function" && ae !== document.body) ae.blur();
  };

  /* floor outline helper (overlay coords: no bgDx) */
  const buildFloorLoopsPx = (rects) => {
    const { dispW, dispH } = getRefFrame();
    const key = (a, b) =>
      a.x < b.x || (a.x === b.x && a.y <= b.y) ? `${a.x},${a.y}|${b.x},${b.y}` : `${b.x},${b.y}|${a.x},${a.y}`;
    const edgeCount = new Map();
    for (const r of rects) {
      const L = round(num(r.fx) * dispW),
        T = round(num(r.fy) * dispH),
        R = round((num(r.fx) + num(r.fw)) * dispW),
        B = round((num(r.fy) + num(r.fh)) * dispH);
      const pts = [
        { x: L, y: T },
        { x: R, y: T },
        { x: R, y: B },
        { x: L, y: B },
      ];
      const edges = [
        [pts[0], pts[1]],
        [pts[1], pts[2]],
        [pts[2], pts[3]],
        [pts[3], pts[0]],
      ];
      for (const [p1, p2] of edges) {
        const k = key(p1, p2);
        edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
      }
    }
    const segments = [];
    for (const [k, c] of edgeCount.entries()) {
      if (c === 1) {
        const [a, b] = k.split("|");
        const [x1, y1] = a.split(",").map((n) => parseInt(n, 10));
        const [x2, y2] = b.split(",").map((n) => parseInt(n, 10));
        segments.push({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });
      }
    }
    const pointKey = (p) => `${p.x},${p.y}`;
    const adj = new Map();
    for (const s of segments) {
      const ka = pointKey(s.a),
        kb = pointKey(s.b);
      if (!adj.has(ka)) adj.set(ka, []);
      if (!adj.has(kb)) adj.set(kb, []);
      adj.get(ka).push(s.b);
      adj.get(kb).push(s.a);
    }
    const visited = new Set();
    const loops = [];
    for (const s of segments) {
      const sk = `${pointKey(s.a)}|${pointKey(s.b)}`;
      if (visited.has(sk)) continue;
      let loop = [s.a];
      let curr = s.b;
      let prev = s.a;
      visited.add(sk);
      while (true) {
        loop.push(curr);
        const neighbors = adj.get(pointKey(curr)) || [];
        let next = neighbors[0] && neighbors[0].x === prev.x && neighbors[0].y === prev.y ? neighbors[1] : neighbors[0];
        if (!next) break;
        const edgeKey = `${pointKey(curr)}|${pointKey(next)}`;
        const edgeKeyRev = `${pointKey(next)}|${pointKey(curr)}`;
        if (visited.has(edgeKey) || visited.has(edgeKeyRev)) {
          const alt = neighbors.find(
            (n) => !(n.x === prev.x && n.y === prev.y) && `${pointKey(curr)}|${pointKey(n)}` !== edgeKey
          );
          if (alt) next = alt;
        }
        visited.add(`${pointKey(curr)}|${pointKey(next)}`);
        prev = curr;
        curr = next;
        if (curr.x === loop[0].x && curr.y === loop[0].y) {
          loop.push(curr);
          break;
        }
      }
      if (loop.length > 2) loops.push(loop);
    }
    return loops;
  };

  /* UI bits */
  const Handles = ({ kind, r }) => {
    if (!selecting) return null;
    const { dispW, dispH } = getRefFrame();
    const leftPx = Math.round(num(r.fx) * dispW), topPx = Math.round(num(r.fy) * dispH);
    const wPx = Math.round(num(r.fw) * dispW), hPx = Math.round(num(r.fh) * dispH);
    const cx = leftPx + wPx / 2, cy = topPx + hPx / 2;
    const color = colorFor(kind);
    const mk = (pos, st, cursor) => (
      <div
        key={pos}
        role="button"
        aria-label={`Resize ${pos}`}
        style={{ ...styles.resizeHandle(color), ...st, cursor, pointerEvents: "auto" }}
        onPointerDown={(e) => onShapeHandlePointerDown(e, kind, r.id, pos)}
      />
    );
    return (
      <>
        {mk("nw", { left: leftPx - 4, top: topPx - 4 }, "nwse-resize")}
        {mk("ne", { left: leftPx + wPx - 4, top: topPx - 4 }, "nesw-resize")}
        {mk("sw", { left: leftPx - 4, top: topPx + hPx - 4 }, "nesw-resize")}
        {mk("se", { left: leftPx + wPx - 4, top: topPx + hPx - 4 }, "nwse-resize")}
        {mk("n",  { left: cx - 4, top: topPx - 4 }, "ns-resize")}
        {mk("s",  { left: cx - 4, top: topPx + hPx - 4 }, "ns-resize")}
        {mk("w",  { left: leftPx - 4, top: cy - 4 }, "ew-resize")}
        {mk("e",  { left: leftPx + wPx - 4, top: cy - 4 }, "ew-resize")}
      </>
    );
  };

  const RectLayer = ({ kind }) => {
    const list = getLayer(kind);
    const { fill, stroke } = COLORS[kind];
    const draftFill = fill.includes("0.35") ? fill.replace("0.35", "0.2") : fill;
    const F = getRefFrame();
    return (
      <>
        {list.map((r) => {
          const leftPx = Math.round(num(r.fx) * F.dispW), topPx = Math.round(num(r.fy) * F.dispH);
          const wPx = Math.round(num(r.fw) * F.dispW), hPx = Math.round(num(r.fh) * F.dispH);
          const isWindow = kind === "window";
          return (
            <React.Fragment key={r.id}>
              <div
                style={{ ...styles.rect(fill, stroke), left: leftPx, top: topPx, width: wPx, height: hPx, border: kind === "floor" ? "none" : `2px solid ${stroke}`, pointerEvents: "auto" }}
                onPointerDown={(e) => onShapeBodyPointerDown(e, kind, r.id)}
                onDoubleClick={(e) => {
                  if (kind === "window") {
                    e.stopPropagation();
                    openWindowPrompt(r.id, r.heightCm);
                  }
                }}
                aria-label={kind}
              />
              {isWindow && typeof r.heightCm === "number" && (
                <div
                  style={{ ...styles.windowTag, left: leftPx, top: topPx }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Window height ${r.heightCm} centimeters. Click to edit.`}
                  onClick={(e) => { e.stopPropagation(); openWindowPrompt(r.id, r.heightCm); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openWindowPrompt(r.id, r.heightCm); } }}
                >
                  {`${r.heightCm} cm`}
                </div>
              )}
              <Handles kind={kind} r={r} />
            </React.Fragment>
          );
        })}
        {activeTool === kind && selecting && draft && (() => {
          const rr = normRect(draft.start.fx, draft.start.fy, draft.end.fx, draft.end.fy);
          const l = Math.round(num(rr.fx) * F.dispW), t = Math.round(num(rr.fy) * F.dispH);
          const w = Math.round(num(rr.fw) * F.dispW), h = Math.round(num(rr.fh) * F.dispH);
          return <div style={{ ...styles.draft(draftFill, stroke), left: l, top: t, width: w, height: h }} />;
        })()}
      </>
    );
  };

  const FloorFigures = () => {
    const F = getRefFrame();
    const bboxFor = (rects) => {
      const xs = rects.map((r) => [num(r.fx), num(r.fx) + num(r.fw)]).flat();
      const ys = rects.map((r) => [num(r.fy), num(r.fy) + num(r.fh)]).flat();
      const L = Math.min(...xs), R = Math.max(...xs), T = Math.min(...ys), B = Math.max(...ys);
      return { fx: L, fy: T, fw: clamp01(R - L), fh: clamp01(B - T) };
    };
    return (
      <>
        {floorFigures.map((fig) => {
          const bb = bboxFor(fig.rects);
          const leftPx = Math.round(num(bb.fx) * F.dispW), topPx = Math.round(num(bb.fy) * F.dispH);
          const wPx = Math.round(num(bb.fw) * F.dispW), hPx = Math.round(num(bb.fh) * F.dispH);
          const loopsPx = buildFloorLoopsPx(fig.rects);
          return (
            <React.Fragment key={fig.id}>
              {fig.rects.map((r, i) => {
                const l = Math.round(num(r.fx) * F.dispW), t = Math.round(num(r.fy) * F.dispH);
                const w = Math.round(num(r.fw) * F.dispW), h = Math.round(num(r.fh) * F.dispH);
                return <div key={i} style={{ ...styles.rect(COLORS.floor.fill, COLORS.floor.stroke), left: l, top: t, width: w, height: h, border: "none" }} />;
              })}
              <svg width={F.dispW} height={F.dispH} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 11 }}>
                {loopsPx.map((loop, idx) => {
                  const d = loop.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";
                  return <path key={idx} d={d} fill="none" stroke={COLORS.floor.stroke} strokeWidth="2" />;
                })}
              </svg>
              {/* drag surface */}
              <div
                role="button"
                aria-label="Drag floor figure"
                style={{ position: "absolute", left: leftPx, top: topPx, width: wPx, height: hPx, cursor: "move", background: "transparent", zIndex: 12, pointerEvents: "auto" }}
                onPointerDown={(e) => onFigurePointerDown(e, fig.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const f = floorFigures.find((ff) => ff.id === fig.id);
                  if (!f) return;
                  const remaining = floorFigures.filter((ff) => ff.id !== fig.id);
                  snapshotState(items, bgUrl, bgSize, walls, windows, [...floors, ...clone(f.rects)], remaining);
                  setSelectedFigureId(null);
                  setActiveTool("floor"); setSelecting(true); setSelectOpen(false);
                }}
                title="Drag (double-click to edit)"
              />
              {/* 8 figure handles when selected */}
              {selectedFigureId === fig.id && (
                <>
                  {[
                    ["nw", leftPx - 4, topPx - 4, "nwse-resize"],
                    ["ne", leftPx + wPx - 4, topPx - 4, "nesw-resize"],
                    ["sw", leftPx - 4, topPx + hPx - 4, "nesw-resize"],
                    ["se", leftPx + wPx - 4, topPx + hPx - 4, "nwse-resize"],
                    ["n",  leftPx + wPx / 2 - 4, topPx - 4, "ns-resize"],
                    ["s",  leftPx + wPx / 2 - 4, topPx + hPx - 4, "ns-resize"],
                    ["w",  leftPx - 4, topPx + hPx / 2 - 4, "ew-resize"],
                    ["e",  leftPx + wPx - 4, topPx + hPx / 2 - 4, "ew-resize"],
                  ].map(([pos, x, y, cursor]) => (
                    <div
                      key={pos}
                      role="button"
                      aria-label={`Resize ${pos}`}
                      title="Hold Shift for uniform scale"
                      style={{ ...styles.resizeHandle(COLORS.floor.stroke), left: x, top: y, cursor, zIndex: 13, pointerEvents: "auto" }}
                      onPointerDown={(e) => onFigureHandlePointerDown(e, fig.id, pos)}
                    />
                  ))}
                </>
              )}
            </React.Fragment>
          );
        })}
      </>
    );
  };

  const Items = () => (
    <>
      {items.map((it) => {
        const F = getRefFrame();
        const left = Math.round(num(it.fx) * F.dispW), top = Math.round(num(it.fy) * F.dispH);
        const baseSize = Math.max(16, Math.min(256, num(it.size || 48)));
        // DOM overlay wrapper scales everything by overlayScale; keep item scale independent here
        const sizePx = Math.round(baseSize);
        const scale = sizePx / 48;
        return (
          <React.Fragment key={it.id}>
            <div
              id={it.id}
              style={{ ...styles.placed, left, top, transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "auto" }}
              onPointerDown={(e) => { e.stopPropagation(); onItemPointerDown(e, it.id); }}
              onClickCapture={(e) => e.stopPropagation()}
              onDragStart={(e) => e.preventDefault()}
              onDoubleClick={() => removeItem(it.id)}
              title={`${it.type}`}
              role="img"
              aria-label={it.type}
              tabIndex={-1}
            >
              {Icon[it.type]?.(48)}
            </div>
            <div
              role="button"
              aria-label="Resize"
              style={{
                position: "absolute",
                left: left + sizePx - 6,
                top: top + sizePx - 6,
                zIndex: 11,
                width: 16,
                height: 16,
                borderRadius: 8,
                background: "#fff",
                border: "1px solid rgba(0,0,0,0.3)",
                boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                display: "grid",
                placeItems: "center",
                cursor: "nwse-resize",
                touchAction: "none",
                pointerEvents: "auto",
              }}
              onPointerDown={(e) => { e.stopPropagation(); onItemResizePointerDown(e, it.id); }}
              onClickCapture={(e) => e.stopPropagation()}
            >
              <span style={{ fontSize: 10, lineHeight: 1, userSelect: "none", pointerEvents: "none" }}>↘︎</span>
            </div>
          </React.Fragment>
        );
      })}
    </>
  );

  const ActiveLabel = activeTool ? (activeTool === "wall" ? "Walls" : activeTool === "window" ? "Windows" : "Floor") : "None";
  const ImgWithSafeDims = () => {
    const { dispW, dispH } = getDisplayDims();
    const w = Math.max(1, dispW), h = Math.max(1, dispH);
    return (
      <img
        src={bgUrl}
        alt="Background"
        draggable={false}
        onDragOver={onCanvasDragOver}
        onDragEnter={onCanvasDragOver}
        onDrop={onCanvasDrop}
        style={{ width: w, height: h, objectFit: "contain", background: "#fff", borderRadius: 0 }}
      />
    );
  };

  return (
    <div style={styles.app} tabIndex={-1} onMouseDown={() => {
      const ae = document.activeElement;
      if (ae && typeof ae.blur === "function" && ae !== document.body) ae.blur();
    }}>
      {/* toolbar */}
      <div style={styles.floaterBar}>
        <button aria-label="Save as image" style={styles.floaterBtn} title="Save as image" onClick={saveCompositionImage}>⬇️</button>
        <button aria-label="Zoom overlays smaller" style={styles.floaterBtn} title="Scale overlays down" onClick={() => nudgeZoom(1/1.1)}>−</button>
        <button aria-label="Zoom overlays larger" style={styles.floaterBtn} title="Scale overlays up" onClick={() => nudgeZoom(1.1)}>＋</button>
        <button aria-label="Clear items/walls" style={styles.floaterBtn} title="Clear items & walls" onClick={clearAll}>🧹</button>
        <button aria-label="Remove background" style={styles.floaterBtn} title="Remove background" onClick={clearBackground}>🗑️</button>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={onInputChange} hidden />
      </div>

      {/* right-center controls */}
      <div style={styles.stack}>
        <div style={styles.selectBtn(selectOpen)}>
          <div style={styles.header(selectOpen)} onClick={toggleSelect} role="button" aria-label="Select tool">
            {`Select${selecting && activeTool ? ` • ${ActiveLabel}` : ""}`}
          </div>
          {selectOpen && (
            <div style={styles.menu}>
              <div style={styles.item(activeTool === "wall", "#ff4da6")} onClick={() => chooseTool("wall")}>Walls</div>
              <div style={styles.item(activeTool === "window", "#00a050")} onClick={() => chooseTool("window")}>Windows</div>
              <div style={styles.item(activeTool === "floor", "#0a28a0")} onClick={() => chooseTool("floor")}>Floor</div>
            </div>
          )}
        </div>
        <button style={styles.stopBtn} onClick={stopSelecting} aria-label="Stop selecting">Stop selecting</button>
      </div>

      {/* palette handle */}
      <button aria-label="Toggle palette" onClick={() => setSidebarOpen((v) => !v)} style={styles.toggleHandle}>{sidebarOpen ? "‹" : "›"}</button>

      {/* palette */}
      <aside style={styles.sidebar(sidebarOpen)} aria-hidden={!sidebarOpen}>
        {PALETTE.map((p) => (
          <div key={p.type} draggable onDragStart={(e) => onPaletteDragStart(e, p.type)} style={styles.paletteCard} title={`Drag ${p.label}`}>
            {Icon[p.type]?.(48)} <div style={{ fontSize: 14 }}>{p.label}</div>
          </div>
        ))}
      </aside>

      {/* canvas */}
      <div
        ref={canvasRef}
        style={{ position: "relative", width: "100%", height: "100%", display: "grid", placeItems: "center" }}
        onDragEnter={onCanvasDragOver}
        onDragOver={onCanvasDragOver}
        onDrop={onCanvasDrop}
        onClick={handleCanvasClick}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerDown={onCanvasPointerDown}
        onPointerCancel={onCanvasPointerCancel}
        onWheel={onCanvasWheel}
      >
        {bgUrl ? (
          <ImgWithSafeDims />
        ) : (
          <div style={{ textAlign: "center", color: "#666" }}>
            <div style={{ fontSize: 18, marginBottom: 6 }}>Drop an image anywhere</div>
            <div style={{ fontSize: 13, marginBottom: 12, opacity: 0.8 }}>or</div>
            <button onClick={() => fileInputRef.current?.click()} style={styles.topChooseBtn}>Choose a file</button>
          </div>
        )}

        {/* Overlays wrapper: positioned on top-left of image and scaled by overlayScale */}
        {(() => {
          const { bgDx, bgDy, dispW, dispH } = getRefFrame();
          const ov = Math.max(0.0001, num(bgSize.overlayScale, 1));
          return (
            <div
              style={{
                position: "absolute",
                left: bgDx,
                top: bgDy,
                width: dispW,
                height: dispH,
                transform: `scale(${ov})`,
                transformOrigin: "top left",
                pointerEvents: "none",
              }}
            >
              {/* layers order: floor (live) → floor figures → wall → window → items */}
              <RectLayer kind="floor" />
              <FloorFigures />
              <RectLayer kind="wall" />
              <RectLayer kind="window" />
              <Items />
            </div>
          );
        })()}
      </div>

      {/* undo / redo */}
      <div style={styles.undoRedoBar}>
        <button style={styles.undoRedoBtn(canUndo)} disabled={!canUndo} onClick={undo} aria-label="Undo" title="Undo (Ctrl/Cmd+Z)">↶ Undo</button>
        <button style={styles.undoRedoBtn(canRedo)} disabled={!canRedo} onClick={redo} aria-label="Redo" title="Redo (Ctrl+Shift+Z / Ctrl+Y)">↷ Redo</button>
      </div>

      {/* window height prompt */}
      {windowPrompt && (
        <form style={styles.note} onSubmit={submitWindowHeight}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Window height above ground</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              autoFocus
              inputMode="decimal"
              placeholder="e.g. 40"
              aria-label="Height above ground in centimeters"
              value={windowPrompt.value}
              onChange={onChangeWindowHeight}
              style={{
                width: 120,
                height: 30,
                padding: "0 10px",
                borderRadius: 8,
                border: `1px solid ${windowPrompt.error ? "#d33" : "rgba(0,0,0,0.2)"}`,
                outline: "none",
              }}
            />
            <span>cm</span>
            <button
              type="submit"
              style={{ height: 32, padding: "0 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.2)", background: "#fff", cursor: "pointer", fontWeight: 700 }}
            >
              Save
            </button>
          </div>
          {windowPrompt.error && <div style={{ marginTop: 6, color: "#d33", fontSize: 12 }}>{windowPrompt.error}</div>}
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>Tip: you can enter decimals (e.g., 37.5)</div>
        </form>
      )}
    </div>
  );
}
