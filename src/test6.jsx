import React, { useRef, useState, useEffect } from "react";

/**
 * AtlaS – React Image Canvas (pure JSX)
 * • Walls (pink), Windows (green), Floor (dark blue)
 * • Right-center Select menu + Stop selecting (hides 8 handles)
 * • Windows: prompt for height above ground (cm) on create; show/editable label near rectangle
 * • Drag icons from palette, zoom/pan (everything), undo/redo, export PNG
 *
 * Hardened to avoid React error #62:
 *  - Robust merge() that only merges plain objects
 *  - Safe deep clone that never throws on non-serializable values
 *  - Numeric guards so styles never receive NaN/Infinity
 */

/* ======================= Yeat-ish bell synth ======================= */
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

  const delayL = ctx.createDelay();
  const delayR = ctx.createDelay();
  delayL.delayTime.value = 0.008;
  delayR.delayTime.value = 0.011;

  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);

  env.connect(splitter);
  splitter.connect(delayL, 0);
  splitter.connect(delayR, 1);
  delayL.connect(merger, 0, 0);
  delayR.connect(merger, 0, 1);
  merger.connect(master);

  carrier.connect(env);
  partial.connect(env);

  carrier.start(t);
  mod.start(t);
  partial.start(t);

  carrier.stop(t + 1.0);
  mod.stop(t + 1.0);
  partial.stop(t + 1.0);
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

/* ======================= tiny utils ======================= */
const isPlainObject = (x) =>
  !!x &&
  typeof x === "object" &&
  (Object.getPrototypeOf(x) === Object.prototype ||
    Object.getPrototypeOf(x) === null);
const merge = (o, p) => ({
  ...(isPlainObject(o) ? o : {}),
  ...(isPlainObject(p) ? p : {}),
});
const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
// Deep clone that never throws: handles undefined/functions/non-serializable.
const clone = (v) => {
  if (v === undefined) return [];
  try {
    if (typeof structuredClone === "function") return structuredClone(v);
  } catch {}
  try {
    return JSON.parse(
      JSON.stringify(v, (_k, val) =>
        typeof val === "function" || val === undefined ? null : val
      )
    );
  } catch {
    if (Array.isArray(v))
      return v.map((x) => (x && typeof x === "object" ? { ...x } : x));
    if (v && typeof v === "object") return { ...v };
    return v;
  }
};
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const round = (v, d = 0) =>
  (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);

const fitWithin = (w, h, maxW, maxH) => {
  const W = num(w),
    H = num(h),
    MW = num(maxW),
    MH = num(maxH);
  if (W <= 0 || H <= 0 || MW <= 0 || MH <= 0) {
    console.warn("fitWithin: invalid", { w, h, maxW, maxH });
    return { w: 0, h: 0 };
  }
  const r = Math.min(MW / W, MH / H);
  const out = { w: Math.round(W * r), h: Math.round(H * r) };
  if (!Number.isFinite(out.w) || !Number.isFinite(out.h)) return { w: 0, h: 0 };
  return out;
};
const isSquareish = (w, h) => {
  const W = num(w),
    H = num(h);
  if (W <= 0 || H <= 0) return false;
  const r = W / H;
  return r > 0.9 && r < 1.1;
};
const normRect = (fx0, fy0, fx1, fy1) => {
  const x0 = clamp01(Math.min(fx0, fx1)),
    y0 = clamp01(Math.min(fy0, fy1));
  const x1 = clamp01(Math.max(fx0, fx1)),
    y1 = clamp01(Math.max(fy0, fy1));
  return { fx: x0, fy: y0, fw: clamp01(x1 - x0), fh: clamp01(y1 - y0) };
};
// Unclamped version (allows drawing outside the image/world)
const normRectLoose = (fx0, fy0, fx1, fy1) => {
  const L = Math.min(num(fx0), num(fx1));
  const T = Math.min(num(fy0), num(fy1));
  const R = Math.max(num(fx0), num(fx1));
  const B = Math.max(num(fy0), num(fy1));
  return { fx: L, fy: T, fw: R - L, fh: B - T };
};

/* ======================= icons & data ======================= */
const stroke = "#333";
const S = {
  fill: "none",
  stroke,
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};
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

/* ======================= styles ======================= */
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
  floaterBar: {
    position: "absolute",
    top: 12,
    right: 12,
    display: "flex",
    gap: 8,
    zIndex: 40,
  },
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
    transform: "translate(-50%, -50%)",
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
  placed: {
    position: "absolute",
    touchAction: "none",
    userSelect: "none",
    cursor: "grab",
    zIndex: 10,
    outline: "none",
  },
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
  undoRedoBar: {
    position: "absolute",
    left: "50%",
    bottom: 16,
    transform: "translateX(-50%)",
    display: "flex",
    gap: 10,
    zIndex: 45,
  },
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
  stack: {
    position: "absolute",
    right: 12,
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: 46,
    width: 160,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
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
  header: (open) => ({
    padding: 8,
    textAlign: "center",
    fontWeight: 700,
    borderBottom: open ? "1px solid rgba(0,0,0,0.1)" : "none",
  }),
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
  stopBtn: {
    width: "100%",
    minHeight: 40,
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.2)",
    background: "#fff",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
  },
  rect: (b, s) => ({
    position: "absolute",
    background: b,
    border: `2px solid ${s}`,
    borderRadius: 0,
    pointerEvents: "auto",
    cursor: "move",
  }),
  draft: (b, s) => ({
    position: "absolute",
    background: b,
    border: `2px dashed ${s}`,
    borderRadius: 0,
    pointerEvents: "none",
  }),
  resizeHandle: (color) => ({
    position: "absolute",
    width: 8,
    height: 8,
    background: "#fff",
    border: `2px solid ${color}`,
    borderRadius: 0,
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
  // pan/zoom + BG
  const [bgPan, setBgPan] = useState({ x: 0, y: 0 });
  const [bgUrl, setBgUrl] = useState(null);
  const lastBgUrlRef = useRef(null);
  // Default world size so you can work before uploading
  const [bgSize, setBgSize] = useState({
    baseW: 1000,
    baseH: 700,
    naturalW: 0,
    naturalH: 0,
    scale: 1,
  });

  // items
  const [items, setItems] = useState([]);

  // layers
  const [walls, setWalls] = useState([]);
  const [windows, setWindows] = useState([]);
  const [floors, setFloors] = useState([]);

  // drawing/selecting
  const [activeTool, setActiveTool] = useState(null); // 'wall' | 'window' | 'floor'
  const [selecting, setSelecting] = useState(false);
  const [draft, setDraft] = useState(null); // {start:{fx,fy}, end:{fx,fy}}
  const [selectOpen, setSelectOpen] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [, forceResizeTick] = useState(0);

  // window height prompt after placing a window
  const [windowPrompt, setWindowPrompt] = useState(null); // { id, value, error }

  // history
  const [history, setHistory] = useState([
    {
      items: [],
      walls: [],
      windows: [],
      floors: [],
      bgUrl: null,
      bgSize: { baseW: 1000, baseH: 700, naturalW: 0, naturalH: 0, scale: 1 },
    },
  ]);
  const [hIndex, setHIndex] = useState(0);
  const canUndo = hIndex > 0,
    canRedo = hIndex < history.length - 1;

  // refs
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const draggingRef = useRef({ id: null, offsetFx: 0, offsetFy: 0 });
  const resizingRef = useRef({ id: null, startSize: 0, startX: 0, startY: 0 });
  const dragStartSnapshotRef = useRef(null);
  const wheelTimerRef = useRef(null);
  const panDragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });
  const pointersRef = useRef(new Map());

  // shape move/resize refs
  const shapeDraggingRef = useRef({
    kind: null,
    id: null,
    offsetFx: 0,
    offsetFy: 0,
    fw: 0,
    fh: 0,
    start: null,
  });
  const shapeResizingRef = useRef({
    kind: null,
    id: null,
    handle: null,
    start: null,
    startLayer: null,
  });

  // audio (bell once on load / first gesture)
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

  // snapshots
  const snapshotState = (
    nextItems = items,
    nextBgUrl = bgUrl,
    nextBgSize = bgSize,
    nextWalls = walls,
    nextWindows = windows,
    nextFloors = floors
  ) => {
    setHistory((prev) => {
      const trimmed = prev.slice(0, hIndex + 1);
      const snap = {
        items: clone(nextItems),
        walls: clone(nextWalls),
        windows: clone(nextWindows),
        floors: clone(nextFloors),
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
    setBgUrl(nextBgUrl);
    setBgSize(nextBgSize);
  };
  const snapshotItems = (next) =>
    snapshotState(next, bgUrl, bgSize, walls, windows, floors);
  const snapshotLayer = (k, next) => {
    if (k === "wall") snapshotState(items, bgUrl, bgSize, next, windows, floors);
    else if (k === "window")
      snapshotState(items, bgUrl, bgSize, walls, next, floors);
    else snapshotState(items, bgUrl, bgSize, walls, windows, next);
  };

  /* ======================= frames (single world) ======================= */
  const getRefFrame = () => {
    const el = canvasRef.current;
    const { left, top, width: cw, height: ch } = getCanvasRect(el);

    const fallbackW = Math.max(1, Math.floor(cw * 0.7));
    const fallbackH = Math.max(1, Math.floor(ch * 0.7));

    const baseW = Math.max(1, num(bgSize.baseW) || fallbackW);
    const baseH = Math.max(1, num(bgSize.baseH) || fallbackH);
    const scale = Math.max(0.01, num(bgSize.scale, 1));

    const dispW = baseW * scale;
    const dispH = baseH * scale;

    // center the world in the canvas, then apply user pan
    const bgDx = Math.floor((cw - dispW) / 2) + Math.round(num(bgPan.x));
    const bgDy = Math.floor((ch - dispH) / 2) + Math.round(num(bgPan.y));

    return {
      left, top, cw, ch,
      baseW, baseH, scale,
      bgDx, bgDy, dispW, dispH,
      refW: baseW, refH: baseH
    };
  };

  // Screen → fractional base coords (unclamped to allow drawing outside)
  const getRel = (x, y) => {
    const f = getRefFrame();
    return {
      fx: (x - (f.left + f.bgDx)) / (f.baseW * f.scale),
      fy: (y - (f.top + f.bgDy)) / (f.baseH * f.scale),
      refW: f.baseW,
      refH: f.baseH,
    };
  };

  // upload
  const onFile = (file) => {
    if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const naturalW = num(img.width),
          naturalH = num(img.height);
        const base = isSquareish(naturalW, naturalH)
          ? { w: 300, h: 300 }
          : fitWithin(naturalW, naturalH, 500, 1000);
        const baseW = base.w > 0 ? base.w : 1000;
        const baseH = base.h > 0 ? base.h : 700;
        if (lastBgUrlRef.current && lastBgUrlRef.current !== url) {
          try { URL.revokeObjectURL(lastBgUrlRef.current); } catch {}
        }
        lastBgUrlRef.current = url;
        snapshotState(
          items,
          url,
          { baseW, baseH, naturalW, naturalH, scale: 1 },
          walls,
          windows,
          floors
        );
      };
      img.src = url;
    } catch {}
  };
  const onInputChange = (e) => {
    const f = e?.target?.files?.[0];
    if (!f) return;
    onFile(f);
    try { e.target.value = ""; } catch {}
  };

  // DnD (palette → canvas)
  const onPaletteDragStart = (e, type) => {
    if (!e?.dataTransfer) return;
    try {
      e.dataTransfer.setData("text/plain", type);
      e.dataTransfer.setData("text", type);
    } catch {}
    e.dataTransfer.effectAllowed = "copyMove";
    if (e.dataTransfer.setDragImage && e.currentTarget) {
      try {
        e.dataTransfer.setDragImage(
          e.currentTarget,
          e.currentTarget.clientWidth / 2,
          e.currentTarget.clientHeight / 2
        );
      } catch {}
    }
  };
  const onCanvasDragOver = (e) => {
    if (!e) return;
    e.preventDefault();
    try { if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } catch {}
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

  // items drag/resize
  const onItemPointerDown = (e, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const { fx, fy } = getRel(e.clientX, e.clientY);
    const it = items.find((x) => x.id === id);
    if (!it) return;
    draggingRef.current = {
      id,
      offsetFx: fx - (it.fx || 0),
      offsetFy: fy - (it.fy || 0),
    };
    dragStartSnapshotRef.current = clone(items);
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  };
  const onItemResizePointerDown = (e, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const it = items.find((x) => x.id === id);
    if (!it) return;
    resizingRef.current = {
      id,
      startSize: Math.max(16, it.size || 48),
      startX: e.clientX,
      startY: e.clientY,
    };
    dragStartSnapshotRef.current = clone(items);
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  };

  // layer utils
  const getLayer = (k) => (k === "wall" ? walls : k === "window" ? windows : floors);
  const setLayer = (k, updater) => {
    if (k === "wall") setWalls(updater);
    else if (k === "window") setWindows(updater);
    else setFloors(updater);
  };
  const colorFor = (k) => (k === "wall" ? "#ff4da6" : k === "window" ? "#00a050" : "#0a28a0");

  // select menu
  const toggleSelect = () => setSelectOpen((v) => !v);
  const chooseTool = (k) => { setActiveTool(k); setSelectOpen(false); setDraft(null); setSelecting(true); };
  const stopSelecting = () => { setSelecting(false); setDraft(null); };

  // create rectangles (click start → click end)
  const handleCanvasClick = (e) => {
    if (!activeTool || !selecting) return;
    const { fx, fy } = getRel(e.clientX, e.clientY);
    if (!draft) { setDraft({ start: { fx, fy }, end: { fx, fy } }); return; }
    // Unclamped rectangle so you can draw outside of the image/world
    const r = normRectLoose(draft.start.fx, draft.start.fy, fx, fy);
    const id = `${activeTool}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const next = [...getLayer(activeTool), { id, ...r }];
    snapshotLayer(activeTool, next);
    setDraft(null);
    if (activeTool === "window") setWindowPrompt({ id, value: "", error: "" });
  };

  // prompt helpers
  const submitWindowHeight = (e) => {
    e?.preventDefault?.();
    if (!windowPrompt) return;
    const raw = (windowPrompt.value ?? "").toString().trim().replace(",", ".");
    const val = Number(raw);
    if (!Number.isFinite(val) || val < 0) {
      setWindowPrompt((p) => ({ ...p, error: "Please enter a non-negative number (cm)." }));
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

  // drag/resize rectangles
  const onShapeBodyPointerDown = (e, k, id) => {
    if (e.button !== 0) return;
    const { fx, fy } = getRel(e.clientX, e.clientY);
    const r = getLayer(k).find((x) => x.id === id);
    if (!r) return;
    shapeDraggingRef.current = {
      kind: k, id,
      offsetFx: fx - (r.fx || 0),
      offsetFy: fy - (r.fy || 0),
      fw: r.fw || 0, fh: r.fh || 0,
      start: clone(getLayer(k)),
    };
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

  // pointer move / pan / pinch
  const MIN_SIDE = 0.005;
  const onCanvasPointerMove = (e) => {
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
      const it = items.find((i) => i.id === rsz.id); if (!it) return;
      const d = Math.max(e.clientX - rsz.startX, e.clientY - rsz.startY);
      const size = Math.max(16, Math.min(256, Math.round(num(rsz.startSize || 48) + d)));
      setItems((p) => p.map((x) => (x.id === rsz.id ? merge(x, { size }) : x)));
      return;
    }
    // shape drag (unclamped)
    const sd = shapeDraggingRef.current;
    if (sd.id) {
      const { fx, fy } = getRel(e.clientX, e.clientY);
      const nx = (num(fx) - num(sd.offsetFx));
      const ny = (num(fy) - num(sd.offsetFy));
      setLayer(sd.kind, (p) => p.map((r) => (r.id === sd.id ? merge(r, { fx: nx, fy: ny }) : r)));
      return;
    }
    // item drag
    const drag = draggingRef.current;
    if (drag.id) {
      const { fx, fy } = getRel(e.clientX, e.clientY);
      setItems((p) =>
        p.map((it) =>
          it.id === drag.id
            ? merge(it, { fx: (num(fx) - num(drag.offsetFx)), fy: (num(fy) - num(drag.offsetFy)) })
            : it
        )
      );
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
    // pinch
    if (e.pointerType === "touch" && pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size === 2) {
        const [p1, p2] = Array.from(pointersRef.current.values());
        const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (!onCanvasPointerMove._lastDist) onCanvasPointerMove._lastDist = dist;
        const factor = dist / onCanvasPointerMove._lastDist;
        if (factor > 0 && !Number.isNaN(factor)) {
          applyZoomAt(midX, midY, factor);
          const prev = onCanvasPointerMove._lastMid || { x: midX, y: midY };
          setBgPan((p) => ({ x: p.x + (midX - prev.x), y: p.y + (midY - prev.y) }));
          onCanvasPointerMove._lastMid = { x: midX, y: midY };
        }
        onCanvasPointerMove._lastDist = dist;
      }
    }
  };

  const onCanvasPointerUp = (e) => {
    const rs = shapeResizingRef.current;
    if (rs.id) {
      const before = rs.startLayer;
      shapeResizingRef.current = { kind: null, id: null, handle: null, start: null, startLayer: null };
      const after = getLayer(rs.kind);
      if (before && JSON.stringify(before) !== JSON.stringify(after)) snapshotLayer(rs.kind, after);
    }
    const rsz = resizingRef.current;
    if (rsz.id) {
      resizingRef.current = { id: null, startSize: 0, startX: 0, startY: 0 };
      const before = dragStartSnapshotRef.current || [];
      if (JSON.stringify(before) !== JSON.stringify(items)) snapshotItems(items);
      dragStartSnapshotRef.current = null;
    }
    const sd = shapeDraggingRef.current;
    if (sd.id) {
      const before = sd.start;
      shapeDraggingRef.current = { kind: null, id: null, offsetFx: 0, offsetFy: 0, fw: 0, fh: 0, start: null };
      const after = getLayer(sd.kind);
      if (before && JSON.stringify(before) !== JSON.stringify(after)) snapshotLayer(sd.kind, after);
    }
    const drag = draggingRef.current;
    if (drag.id != null) {
      draggingRef.current = { id: null, offsetFx: 0, offsetFy: 0 };
      const before = dragStartSnapshotRef.current || [];
      if (JSON.stringify(before) !== JSON.stringify(items)) snapshotItems(items);
      dragStartSnapshotRef.current = null;
    }
    if (panDragRef.current.active) { panDragRef.current.active = false; scheduleBgSnapshot(); }
    if (e?.pointerId != null) pointersRef.current.delete(e.pointerId);
    onCanvasPointerMove._lastDist = null;
    onCanvasPointerMove._lastMid = null;
  };

  const onCanvasPointerCancel = (e) => {
    if (e?.pointerId != null) pointersRef.current.delete(e.pointerId);
    panDragRef.current.active = false;
    onCanvasPointerMove._lastDist = null;
    onCanvasPointerMove._lastMid = null;
    shapeResizingRef.current = { kind: null, id: null, handle: null, start: null, startLayer: null };
  };

  const onCanvasPointerDown = (e) => {
    if (e.pointerType === "touch")
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const panKey = e.button === 1 || e.buttons === 4 || e.getModifierState?.("Space");
    if (panKey) {
      e.preventDefault();
      panDragRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        origX: num(bgPan.x),
        origY: num(bgPan.y),
      };
    }
  };

  // zoom
  const scheduleBgSnapshot = (nextBgSize) => {
    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = setTimeout(() => {
      snapshotState(items, bgUrl, nextBgSize ?? bgSize, walls, windows, floors);
    }, 300);
  };
  const applyZoomAt = (screenX, screenY, factor) => {
    const f = Number.isFinite(factor) ? factor : 1;
    if (f <= 0) return;

    setBgSize((s) => {
      const currScale = Math.max(0.01, num(s.scale, 1));
      const nextScale = Math.min(5, Math.max(0.2, currScale * f));
      if (Math.abs(nextScale - currScale) < 1e-6) return s;

      const el = canvasRef.current;
      const { left, top, width: cw, height: ch } = getCanvasRect(el);
      const baseW = Math.max(1, num(s.baseW));
      const baseH = Math.max(1, num(s.baseH));

      const dispW = baseW * currScale;
      const dispH = baseH * currScale;

      const beforeDx = Math.floor((cw - dispW) / 2) + Math.round(num(bgPan.x));
      const beforeDy = Math.floor((ch - dispH) / 2) + Math.round(num(bgPan.y));

      const offsetX = screenX - (left + beforeDx);
      const offsetY = screenY - (top + beforeDy);

      const scaleRatio = nextScale / currScale;

      setBgPan((p) => ({
        x: num(p.x) - offsetX * (scaleRatio - 1),
        y: num(p.y) - offsetY * (scaleRatio - 1),
      }));

      const next = { ...s, scale: nextScale };
      scheduleBgSnapshot(next);
      return next;
    });
  };
  const onCanvasWheel = (e) => {
    if (!(e.shiftKey || e.ctrlKey)) return; // require modifier
    e.preventDefault();
    const factor = 1 + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey && e.ctrlKey ? 0.15 : 0.1);
    applyZoomAt(e.clientX, e.clientY, factor);
  };
  const nudgeZoom = (m) => {
    const { left, top, width, height } = getCanvasRect(canvasRef.current);
    applyZoomAt(left + width / 2, top + height / 2, m);
  };

  // keep world fixed when canvas resizes
  useEffect(() => {
    if (!canvasRef.current) return;

    const getDxDy = (cw, ch, dispW, dispH, pan) => ({
      dx: Math.floor((cw - dispW) / 2) + Math.round(num(pan.x)),
      dy: Math.floor((ch - dispH) / 2) + Math.round(num(pan.y)),
    });

    let prevCw = null;
    let prevCh = null;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const cw = Math.round(entry.contentRect.width);
      const ch = Math.round(entry.contentRect.height);
      if (prevCw == null || prevCh == null) {
        prevCw = cw;
        prevCh = ch;
        return;
      }

      const baseW = Math.max(1, num(bgSize.baseW) || Math.floor(cw * 0.7));
      const baseH = Math.max(1, num(bgSize.baseH) || Math.floor(ch * 0.7));
      const scale = Math.max(0.01, num(bgSize.scale, 1));
      const dispW = baseW * scale;
      const dispH = baseH * scale;

      const before = getDxDy(prevCw, prevCh, dispW, dispH, bgPan);
      const after = getDxDy(cw, ch, dispW, dispH, bgPan);

      const deltaX = before.dx - after.dx;
      const deltaY = before.dy - after.dy;

      if (deltaX !== 0 || deltaY !== 0) {
        setBgPan((p) => ({ x: num(p.x) + deltaX, y: num(p.y) + deltaY }));
      }

      prevCw = cw;
      prevCh = ch;
    });

    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [bgSize.baseW, bgSize.baseH, bgSize.scale, bgPan.x, bgPan.y]);

  // toolbar
  const clearAll = () => snapshotState([], bgUrl, bgSize, [], [], []);
  const removeItem = (id) => snapshotItems(items.filter((it) => it.id !== id));
  const clearBackground = () => {
    const reset = { baseW: bgSize.baseW, baseH: bgSize.baseH, naturalW: 0, naturalH: 0, scale: 1 };
    if (lastBgUrlRef.current) { try { URL.revokeObjectURL(lastBgUrlRef.current); } catch {} lastBgUrlRef.current = null; }
    snapshotState(items, null, reset, walls, windows, floors);
  };

  async function saveCompositionImage() {
    try {
      if (!canvasRef.current) return;
      const { bgDx, bgDy, dispW, dispH, refW, refH } = getRefFrame();

      const outW = Math.max(1, round(dispW, 1));
      const outH = Math.max(1, round(dispH, 1));

      const canvas = document.createElement("canvas");
      const dpr = Math.max(1, Math.floor(num(window.devicePixelRatio, 1)));
      canvas.width = outW * dpr;
      canvas.height = outH * dpr;
      canvas.style.width = `${outW}px`;
      canvas.style.height = `${outH}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      // BG
      if (bgUrl) {
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => { ctx.drawImage(img, 0, 0, outW, outH); resolve(); };
          img.onerror = resolve;
          img.src = bgUrl;
        });
      } else {
        ctx.fillStyle = "#faf9f5";
        ctx.fillRect(0, 0, outW, outH);
      }

      // Draw rect layers
      const drawRects = (list, color) => {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        for (const r of list) {
          const leftPx = round(num(r.fx) * refW) - round(num(bgDx));
          const topPx  = round(num(r.fy) * refH)  - round(num(bgDy));
          const wPx    = round(num(r.fw) * refW);
          const hPx    = round(num(r.fh) * refH);
          ctx.fillRect(leftPx, topPx, wPx, hPx);
          ctx.strokeRect(leftPx, topPx, wPx, hPx);
        }
        ctx.restore();
      };
      drawRects(floors, "#0a28a0");
      drawRects(walls,  "#ff4da6");
      drawRects(windows,"#00a050");

      // Items (SVGs)
      for (const it of items) {
        const node = document.getElementById(it.id);
        if (!node) continue;
        const svg = node.querySelector("svg");
        if (!svg) continue;

        const left0 = round(num(it.fx) * refW) - round(num(bgDx));
        const top0  = round(num(it.fy) * refH) - round(num(bgDy));
        const cloneSvg = svg.cloneNode(true);
        const svgStr = new XMLSerializer().serializeToString(cloneSvg);
        const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const sizePx = Math.max(16, Math.min(256, num(it.size || 48)));

        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => { ctx.drawImage(img, left0, top0, sizePx, sizePx); URL.revokeObjectURL(url); resolve(); };
          img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          img.src = url;
        });
      }

      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = "composition.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error("saveCompositionImage failed", err);
      alert("Could not save the composition image.");
    }
  }

  // undo/redo
  const undo = () => {
    if (!canUndo) return;
    const i = hIndex - 1;
    setHIndex(i);
    const s = history[i];
    setItems(clone(s.items));
    setWalls(clone(s.walls || []));
    setWindows(clone(s.windows || []));
    setFloors(clone(s.floors || []));
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
    setBgUrl(s.bgUrl);
    setBgSize({ ...s.bgSize });
  };

  // shortcuts + resize
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

  const { refW, refH } = getRefFrame();

  /* ======================= components ======================= */
  const Handles = ({ kind, r }) => {
    if (!selecting) return null;
    const leftPx = Math.round(num(r.fx) * refW),
      topPx = Math.round(num(r.fy) * refH);
    const wPx = Math.round(num(r.fw) * refW),
      hPx = Math.round(num(r.fh) * refH);
    const cx = leftPx + wPx / 2,
      cy = topPx + hPx / 2;
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
    return (
      <>
        {list.map((r) => {
          const leftPx = Math.round(num(r.fx) * refW),
            topPx = Math.round(num(r.fy) * refH);
          const wPx = Math.round(num(r.fw) * refW),
            hPx = Math.round(num(r.fh) * refH);
          const isWindow = kind === "window";
          return (
            <React.Fragment key={r.id}>
              <div
                style={{
                  ...styles.rect(fill, stroke),
                  left: leftPx,
                  top: topPx,
                  width: wPx,
                  height: hPx,
                  pointerEvents: "auto",
                }}
                onPointerDown={(e) => onShapeBodyPointerDown(e, kind, r.id)}
                onDoubleClick={(e) => {
                  if (isWindow) { e.stopPropagation(); openWindowPrompt(r.id, r.heightCm); }
                }}
                aria-label={kind}
              />
              {isWindow && typeof r.heightCm === "number" && (
                <div
                  style={{ ...styles.windowTag, left: leftPx, top: topPx, pointerEvents: "auto" }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Window height ${r.heightCm} centimeters. Click to edit.`}
                  onClick={(e) => { e.stopPropagation(); openWindowPrompt(r.id, r.heightCm); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openWindowPrompt(r.id, r.heightCm); }
                  }}
                >
                  {`${r.heightCm} cm`}
                </div>
              )}
              <Handles kind={kind} r={r} />
            </React.Fragment>
          );
        })}
        {activeTool === kind && selecting && draft && (() => {
          const rr = normRectLoose(draft.start.fx, draft.start.fy, draft.end.fx, draft.end.fy);
          const l = Math.round(num(rr.fx) * refW),
            t = Math.round(num(rr.fy) * refH);
          const w = Math.round(num(rr.fw) * refW),
            h = Math.round(num(rr.fh) * refH);
          return (
            <div
              style={{ ...styles.draft(draftFill, stroke), left: l, top: t, width: w, height: h, pointerEvents: "none" }}
            />
          );
        })()}
      </>
    );
  };

  const Items = () => (
    <>
      {items.map((it) => {
        const left = Math.round(num(it.fx) * refW),
          top = Math.round(num(it.fy) * refH);
        const sizePx = Math.max(16, Math.min(256, num(it.size || 48)));
        const scale = sizePx / 48;
        return (
          <React.Fragment key={it.id}>
            <div
              id={it.id}
              style={{
                ...styles.placed,
                left,
                top,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                pointerEvents: "auto",
              }}
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

  const ActiveLabel = activeTool
    ? activeTool === "wall"
      ? "Walls"
      : activeTool === "window"
      ? "Windows"
      : "Floor"
    : "None";

  return (
    <div
      style={styles.app}
      tabIndex={-1}
      onMouseDown={() => {
        const ae = document.activeElement;
        if (ae && typeof ae.blur === "function" && ae !== document.body) ae.blur();
      }}
    >
      {/* toolbar */}
      <div style={styles.floaterBar}>
        <button aria-label="Save as image" style={styles.floaterBtn} title="Save as image" onClick={saveCompositionImage}>⬇️</button>
        <button aria-label="Zoom out" style={styles.floaterBtn} title="Zoom out" onClick={() => nudgeZoom(1 / 1.1)}>−</button>
        <button aria-label="Zoom in" style={styles.floaterBtn} title="Zoom in" onClick={() => nudgeZoom(1.1)}>＋</button>
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
      <button aria-label="Toggle palette" onClick={() => setSidebarOpen((v) => !v)} style={styles.toggleHandle}>
        {sidebarOpen ? "‹" : "›"}
      </button>

      {/* palette */}
      <aside style={styles.sidebar(sidebarOpen)} aria-hidden={!sidebarOpen}>
        {PALETTE.map((p) => (
          <div key={p.type} draggable onDragStart={(e) => onPaletteDragStart(e, p.type)} style={styles.paletteCard} title={`Drag ${p.label}`}>
            {Icon[p.type]?.(48)}
            <div style={{ fontSize: 14 }}>{p.label}</div>
          </div>
        ))}
      </aside>

      {/* canvas */}
      <div
        ref={canvasRef}
        style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
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
        {(() => {
          const { bgDx, bgDy, baseW, baseH, scale } = getRefFrame();
          return (
            <div
              style={{
                position: "absolute",
                left: bgDx,
                top: bgDy,
                width: baseW,
                height: baseH,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                // IMPORTANT: allow events on children
                pointerEvents: "auto",
                background: "#faf9f5",  // same as app background
                boxShadow: "none",
              }}
            >
              {bgUrl && (
                <img
                  src={bgUrl}
                  alt="Background"
                  draggable={false}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: baseW,
                    height: baseH,
                    background: "#fff",
                  }}
                />
              )}

              {/* layers order: floor → wall → window → items */}
              <RectLayer kind="floor" />
              <RectLayer kind="wall" />
              <RectLayer kind="window" />
              <Items />
            </div>
          );
        })()}

        {!bgUrl && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              pointerEvents: "none",
            }}
          >
            <div style={{ textAlign: "center", color: "#666", pointerEvents: "auto" }}>
              <div style={{ fontSize: 18, marginBottom: 6 }}>Drop an image anywhere</div>
              <div style={{ fontSize: 13, marginBottom: 12, opacity: 0.8 }}>or</div>
              <button onClick={() => fileInputRef.current?.click()} style={styles.topChooseBtn}>
                Choose a file
              </button>
            </div>
          </div>
        )}
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
              style={{
                height: 32,
                padding: "0 12px",
                borderRadius: 8,
                border: "1px solid rgba(0,0,0,0.2)",
                background: "#fff",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              Save
            </button>
          </div>
          {windowPrompt.error && (
            <div style={{ marginTop: 6, color: "#d33", fontSize: 12 }}>{windowPrompt.error}</div>
          )}
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>Tip: you can enter decimals (e.g., 37.5)</div>
        </form>
      )}
    </div>
  );
}
