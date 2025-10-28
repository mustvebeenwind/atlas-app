// @ts-nocheck
import React, { useRef, useState, useEffect } from "react";

/**
 * AtlaS – React Image Canvas (JSX-only, no TS)
 * + Walls, Windows (green), Floor (dark blue)
 * + Right-center "Select" button (Walls/Windows/Floor)
 * + NEW: "Stop selecting" button hides all 8 resize handles; handles only show in select mode
 * + Windows: after placing, show bottom note asking for height (defaults to 40×200 cm)
 */

// ---------- Helpers ----------
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const deepClone = (v) => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
const fitWithin = (w, h, maxW, maxH) => {
  if (!w || !h) return { w: 0, h: 0 };
  const r = Math.min(maxW / w, maxH / h);
  return { w: Math.round(w * r), h: Math.round(h * r) };
};
const isRoughlySquare = (w, h) => !!(w && h) && w / h > 0.9 && w / h < 1.1;
const normRect = (fx0, fy0, fx1, fy1) => {
  const x0 = clamp01(Math.min(fx0, fx1));
  const y0 = clamp01(Math.min(fy0, fy1));
  const x1 = clamp01(Math.max(fx0, fx1));
  const y1 = clamp01(Math.max(fy0, fy1));
  return { fx: x0, fy: y0, fw: clamp01(x1 - x0), fh: clamp01(y1 - y0) };
};

// ---------- Icons ----------
const stroke = "#333";
const c = { fill: "none", stroke, strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" };
const Icon = {
  bed: (s = 48) => (
    <svg width={s} height={s} viewBox="0 0 64 64" role="img" aria-label="bed">
      <rect x="6" y="30" width="52" height="18" rx="3" {...c} />
      <rect x="10" y="24" width="22" height="10" rx="2" {...c} />
      <line x1="6" y1="48" x2="6" y2="54" {...c} />
      <line x1="58" y1="48" x2="58" y2="54" {...c} />
    </svg>
  ),
  door: (s = 48) => (
    <svg width={s} height={s} viewBox="0 0 64 64" role="img" aria-label="door">
      <rect x="18" y="6" width="28" height="52" rx="2" {...c} />
      <circle cx="40" cy="32" r="2.5" stroke={stroke} fill={stroke} />
    </svg>
  ),
  table: (s = 48) => (
    <svg width={s} height={s} viewBox="0 0 64 64" role="img" aria-label="table">
      <rect x="10" y="22" width="44" height="8" rx="2" {...c} />
      <line x1="18" y1="30" x2="18" y2="50" {...c} />
      <line x1="46" y1="30" x2="46" y2="50" {...c} />
    </svg>
  ),
  chair: (s = 48) => (
    <svg width={s} height={s} viewBox="0 0 64 64" role="img" aria-label="chair">
      <rect x="22" y="14" width="20" height="14" rx="2" {...c} />
      <rect x="22" y="28" width="20" height="8" rx="2" {...c} />
      <line x1="24" y1="36" x2="24" y2="50" {...c} />
      <line x1="40" y1="36" x2="40" y2="50" {...c} />
    </svg>
  ),
};
const PALETTE = [
  { type: "bed", label: "Bed" },
  { type: "door", label: "Door" },
  { type: "table", label: "Table" },
  { type: "chair", label: "Chair" },
];

let idCounter = 1;
const nextId = () => `item_${idCounter++}`;

// ---------- Styles ----------
const styles = {
  app: { width: "100vw", height: "100vh", background: "#faf9f5", color: "#333", fontFamily: "Inter, system-ui, Arial, sans-serif", position: "relative", userSelect: "none" },
  sidebar: (open) => ({ position: "absolute", top: 0, left: 0, bottom: 0, width: 180, background: "#faf9f5", borderRight: "1px solid rgba(0,0,0,.1)", transform: `translateX(${open ? 0 : -180}px)`, transition: "transform .25s ease, opacity .2s ease", padding: 12, display: "flex", flexDirection: "column", gap: 12, zIndex: 20, opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }),
  paletteCard: { background: "transparent", border: "1px solid rgba(0,0,0,.1)", borderRadius: 12, padding: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, cursor: "grab", textAlign: "center" },
  floaterBar: { position: "absolute", top: 12, right: 12, display: "flex", gap: 8, zIndex: 40 },
  floaterBtn: { width: 44, height: 44, borderRadius: 22, background: "rgba(0,0,0,0.0)", border: "1px solid rgba(0,0,0,0.2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  handle: { position: "absolute", top: "50%", left: 0, transform: "translate(-50%, -50%)", width: 28, height: 64, borderRadius: 14, background: "rgba(0,0,0,0.08)", border: "1px solid rgba(0,0,0,0.15)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#111", zIndex: 30 },
  placed: { position: "absolute", touchAction: "none", userSelect: "none", cursor: "grab", zIndex: 10, outline: "none" },
  topChooseBtn: { fontSize: 14, cursor: "pointer", background: "transparent", color: "#666", border: "1px solid rgba(0,0,0,0.2)", padding: "10px 14px", borderRadius: 10, lineHeight: 1.2 },
  infoBtn: { position: "absolute", right: 16, bottom: 16, width: 44, height: 44, borderRadius: 22, background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, zIndex: 50 },
  infoBox: { position: "absolute", right: 70, bottom: 20, background: "#fff", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 8, padding: 12, fontSize: 12, color: "#333", width: 260, boxShadow: "0 2px 6px rgba(0,0,0,0.1)" },
  undoRedoBar: { position: "absolute", left: "50%", bottom: 16, transform: "translateX(-50%)", display: "flex", gap: 10, zIndex: 45 },
  undoRedoBtn: (ena) => ({ minWidth: 72, height: 40, padding: "0 14px", borderRadius: 10, background: "rgba(0,0,0,0.03)", border: `1px solid rgba(0,0,0,${ena ? 0.25 : 0.12})`, color: ena ? "#222" : "#999", cursor: ena ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 14 }),

  // Right-center control stack
  selectStack: { position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", zIndex: 46, width: 120, display: "flex", flexDirection: "column", gap: 8 },
  selectBtn: (open) => ({ width: "100%", minHeight: 44, borderRadius: 14, border: "1px solid rgba(0,0,0,0.2)", background: open ? "#fff" : "rgba(0,0,0,0.02)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "center", fontSize: 12, color: "#333" }),
  selectHeader: (open, activeLabel) => ({ padding: 8, textAlign: 'center', fontWeight: 700, borderBottom: open ? '1px solid rgba(0,0,0,0.1)' : 'none' }),
  selectMenu: { display: "flex", flexDirection: "column", gap: 6, padding: 8 },
  selectItem: (active, color) => ({ padding: "8px 10px", borderRadius: 10, border: `1px solid ${active ? color : 'rgba(0,0,0,0.15)' }`, background: active ? `${color}22` : "transparent", cursor: "pointer", textAlign: "center", fontWeight: 600 }),
  stopBtn: { width: "100%", minHeight: 40, borderRadius: 12, border: "1px solid rgba(0,0,0,0.2)", background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 },

  // Rect styles per type
  rect_wall: { position: "absolute", background: "rgba(255,77,166,0.35)", border: "2px solid rgba(255,77,166,0.85)", borderRadius: 4, pointerEvents: "auto", cursor: "move", zIndex: 2 },
  rect_window: { position: "absolute", background: "rgba(0,160,80,0.35)", border: "2px solid rgba(0,160,80,0.85)", borderRadius: 4, pointerEvents: "auto", cursor: "move", zIndex: 2 },
  rect_floor: { position: "absolute", background: "rgba(10,40,160,0.35)", border: "2px solid rgba(10,40,160,0.9)", borderRadius: 4, pointerEvents: "auto", cursor: "move", zIndex: 1 },

  draft_wall: { position: "absolute", background: "rgba(255,77,166,0.2)", border: "2px dashed rgba(255,77,166,0.85)", borderRadius: 4, pointerEvents: "none", zIndex: 1 },
  draft_window: { position: "absolute", background: "rgba(0,160,80,0.2)", border: "2px dashed rgba(0,160,80,0.85)", borderRadius: 4, pointerEvents: "none", zIndex: 1 },
  draft_floor: { position: "absolute", background: "rgba(10,40,160,0.2)", border: "2px dashed rgba(10,40,160,0.9)", borderRadius: 4, pointerEvents: "none", zIndex: 0 },

  resizeHandle: { position: "absolute", right: -6, bottom: -6, width: 16, height: 16, borderRadius: 8, background: "#fff", border: "1px solid rgba(0,0,0,0.3)", boxShadow: "0 1px 2px rgba(0,0,0,0.2)", display: "grid", placeItems: "center", cursor: "nwse-resize", touchAction: "none" },
  resizeGlyph: { fontSize: 10, lineHeight: 1, userSelect: "none", pointerEvents: "none" },
  wallHandle: (color) => ({ position: "absolute", width: 12, height: 12, background: "#fff", border: `2px solid ${color}`, borderRadius: 3, boxShadow: "0 1px 2px rgba(0,0,0,0.15)", zIndex: 3, touchAction: "none" }),

  // Bottom window note
  bottomNote: { position: "absolute", left: '50%', bottom: 64, transform: 'translateX(-50%)', background: '#fff', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 10, padding: '8px 12px', fontSize: 13, color: '#0a0a0a', boxShadow: '0 2px 6px rgba(0,0,0,0.08)', zIndex: 48 }
};

// ---------- Geometry ----------
function getCanvasRect(el) {
  if (!el) return { left: 0, top: 0, width: 0, height: 0 };
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

export default function ImageCanvasApp() {
  // Pan/zoom + BG state
  const [bgPan, setBgPan] = useState({ x: 0, y: 0 });
  const [bgUrl, setBgUrl] = useState(null);
  const lastBgUrlRef = useRef(null);
  const [bgSize, setBgSize] = useState({ baseW: 0, baseH: 0, naturalW: 0, naturalH: 0, scale: 1 });

  // Items & UI state
  const [items, setItems] = useState([]);

  // Rect layers
  const [walls, setWalls] = useState([]);
  const [windows, setWindows] = useState([]);
  const [floors, setFloors] = useState([]);

  // Drawing/selecting
  const [activeTool, setActiveTool] = useState(null); // 'wall' | 'window' | 'floor' | null
  const [selecting, setSelecting] = useState(false);   // controls handle visibility + drawing
  const [draft, setDraft] = useState(null); // {start:{fx,fy}, end:{fx,fy}}
  const [selectOpen, setSelectOpen] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [, forceResizeTick] = useState(0);

  // Window note state
  const [windowNote, setWindowNote] = useState(null); // string or null

  // History
  const [history, setHistory] = useState([{ items: [], walls: [], windows: [], floors: [], bgUrl: null, bgSize: { baseW: 0, baseH: 0, naturalW: 0, naturalH: 0, scale: 1 } }]);
  const [hIndex, setHIndex] = useState(0);
  const canUndo = hIndex > 0, canRedo = hIndex < history.length - 1;

  // Refs
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const draggingRef = useRef({ id: null, offsetFx: 0, offsetFy: 0 });
  const resizingRef = useRef({ id: null, startSize: 0, startX: 0, startY: 0 });
  const dragStartSnapshotRef = useRef(null);
  const wheelTimerRef = useRef(null);
  const panDragRef = useRef({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 });
  const pointersRef = useRef(new Map());

  // Generic shape drag/resize refs
  const shapeDraggingRef = useRef({ kind: null, id: null, offsetFx: 0, offsetFy: 0, fw: 0, fh: 0, start: null });
  const shapeResizingRef = useRef({ kind: null, id: null, handle: null, start: null, startLayer: null });

  // Snapshot helpers
  const snapshotState = (nextItems = items, nextBgUrl = bgUrl, nextBgSize = bgSize, nextWalls = walls, nextWindows = windows, nextFloors = floors) => {
    setHistory((prev) => {
      const trimmed = prev.slice(0, hIndex + 1);
      const snap = { items: deepClone(nextItems), walls: deepClone(nextWalls), windows: deepClone(nextWindows), floors: deepClone(nextFloors), bgUrl: nextBgUrl, bgSize: { ...nextBgSize } };
      const newHist = [...trimmed, snap];
      setHIndex(newHist.length - 1);
      return newHist;
    });
    setItems(nextItems); setWalls(nextWalls); setWindows(nextWindows); setFloors(nextFloors); setBgUrl(nextBgUrl); setBgSize(nextBgSize);
  };
  const snapshotItems = (next) => snapshotState(next, bgUrl, bgSize, walls, windows, floors);
  const snapshotLayer = (kind, next) => {
    if (kind === 'wall') snapshotState(items, bgUrl, bgSize, next, windows, floors);
    else if (kind === 'window') snapshotState(items, bgUrl, bgSize, walls, next, floors);
    else if (kind === 'floor') snapshotState(items, bgUrl, bgSize, walls, windows, next);
  };

  // Frames
  const getDisplayDims = () => ({ dispW: Math.max(0, Math.round(bgSize.baseW * bgSize.scale)), dispH: Math.max(0, Math.round(bgSize.baseH * bgSize.scale)) });
  const getBgFrame = () => {
    const el = canvasRef.current; const { width: cw, height: ch, left, top } = getCanvasRect(el);
    const { dispW, dispH } = getDisplayDims();
    const dx = Math.floor((cw - dispW) / 2) + Math.round(bgPan.x);
    const dy = Math.floor((ch - dispH) / 2) + Math.round(bgPan.y);
    return { dx, dy, left, top, cw, ch, dispW, dispH };
  };
  const getRefFrame = () => { const f = getBgFrame(); return { dx: 0, dy: 0, left: f.left, top: f.top, refW: f.cw, refH: f.ch, cw: f.cw, ch: f.ch, bgDx: f.dx, bgDy: f.dy, dispW: f.dispW, dispH: f.dispH }; };
  const getRel = (clientX, clientY) => { const { dx, dy, left, top, refW, refH } = getRefFrame(); const x = clamp01((clientX - (left + dx)) / (refW || 1)); const y = clamp01((clientY - (top + dy)) / (refH || 1)); return { fx: x, fy: y, refW, refH }; };

  // Upload handling
  const onFile = (file) => {
    if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const naturalW = img.width, naturalH = img.height;
        const { w: baseW, h: baseH } = isRoughlySquare(naturalW, naturalH) ? { w: 300, h: 300 } : fitWithin(naturalW, naturalH, 500, 1000);
        if (lastBgUrlRef.current && lastBgUrlRef.current !== url) { try { URL.revokeObjectURL(lastBgUrlRef.current); } catch {} }
        lastBgUrlRef.current = url;
        snapshotState(items, url, { baseW, baseH, naturalW, naturalH, scale: 1 }, walls, windows, floors);
      };
      img.src = url;
    } catch {}
  };
  const onInputChange = (e) => { const f = e?.target?.files?.[0]; if (!f) return; onFile(f); try { e.target.value = ""; } catch {} };

  // DnD palette → canvas
  const onPaletteDragStart = (e, type) => {
    if (!e?.dataTransfer) return;
    try { e.dataTransfer.setData("text/plain", type); e.dataTransfer.setData("text", type); } catch {}
    e.dataTransfer.effectAllowed = "copyMove";
    if (e.dataTransfer.setDragImage && e.currentTarget) {
      try { e.dataTransfer.setDragImage(e.currentTarget, e.currentTarget.clientWidth / 2, e.currentTarget.clientHeight / 2); } catch {}
    }
  };
  const onCanvasDragOver = (e) => { if (!e) return; e.preventDefault(); try { if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } catch {} };
  const dropOnCanvas = (x, y, type) => { const { fx, fy } = getRel(x, y); snapshotItems([...items, { id: nextId(), type, fx, fy, size: 48 }]); };
  const onCanvasDrop = (e) => {
    e.preventDefault(); const dt = e.dataTransfer;
    if (dt?.files?.length > 0) { const f = dt.files[0]; if (f?.type?.startsWith("image/")) onFile(f); return; }
    const type = dt.getData("text/plain") || dt.getData("text"); if (type) dropOnCanvas(e.clientX, e.clientY, type);
  };

  // Items drag/resize
  const onItemPointerDown = (e, id) => {
    if (e.button !== 0) return; e.stopPropagation();
    const { fx, fy } = getRel(e.clientX, e.clientY);
    const item = items.find((it) => it.id === id); if (!item) return;
    draggingRef.current = { id, offsetFx: fx - (item.fx || 0), offsetFy: fy - (item.fy || 0) };
    dragStartSnapshotRef.current = deepClone(items);
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  };
  const onItemResizePointerDown = (e, id) => {
    if (e.button !== 0) return; e.stopPropagation();
    const it = items.find((i) => i.id === id); if (!it) return;
    resizingRef.current = { id, startSize: Math.max(16, it.size || 48), startX: e.clientX, startY: e.clientY };
    dragStartSnapshotRef.current = deepClone(items);
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  };

  // ---- Shape helpers
  const getLayer = (kind) => (kind === 'wall' ? walls : kind === 'window' ? windows : floors);
  const setLayer = (kind, updater) => {
    if (kind === 'wall') setWalls(updater);
    else if (kind === 'window') setWindows(updater);
    else if (kind === 'floor') setFloors(updater);
  };
  const colorFor = (kind) => (kind === 'wall' ? '#ff4da6' : kind === 'window' ? '#00a050' : '#0a28a0');

  // Select menu actions
  const toggleSelect = () => setSelectOpen((v) => !v);
  const chooseTool = (kind) => { setActiveTool(kind); setSelectOpen(false); setDraft(null); setSelecting(true); };
  const stopSelecting = () => { setSelecting(false); setDraft(null); };

  // Create rectangles by clicking twice (start/end)
  const handleCanvasClick = (e) => {
    if (!activeTool || !selecting) return; const { fx, fy } = getRel(e.clientX, e.clientY);
    if (!draft) { setDraft({ start: { fx, fy }, end: { fx, fy } }); return; }
    const r = normRect(draft.start.fx, draft.start.fy, fx, fy);
    const id = `${activeTool}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const next = [...getLayer(activeTool), { id, ...r }];
    snapshotLayer(activeTool, next);
    setDraft(null);
    // Window note when placing a window
    if (activeTool === 'window') {
      setWindowNote('New window placed — what\'s its height? (currently 40×200 cm)');
      // auto-hide after a few seconds so it doesn't stick forever
      clearTimeout(handleCanvasClick._noteTimer);
      handleCanvasClick._noteTimer = setTimeout(() => setWindowNote(null), 6000);
    }
  };

  // Drag/resize existing rectangles (generic)
  const onShapeBodyPointerDown = (e, kind, id) => {
    if (e.button !== 0) return;
    const { fx, fy } = getRel(e.clientX, e.clientY);
    const rect = getLayer(kind).find((r) => r.id === id); if (!rect) return;
    shapeDraggingRef.current = { kind, id, offsetFx: fx - (rect.fx || 0), offsetFy: fy - (rect.fy || 0), fw: rect.fw || 0, fh: rect.fh || 0, start: deepClone(getLayer(kind)) };
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  };
  const onShapeHandlePointerDown = (e, kind, id, handle) => {
    if (!selecting) return; // ignore if not in select mode
    e.stopPropagation();
    const rect = getLayer(kind).find((r) => r.id === id); if (!rect) return;
    shapeResizingRef.current = { kind, id, handle, start: { ...rect }, startLayer: deepClone(getLayer(kind)) };
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  };

  // Pointer move / pan / pinch
  const MIN_SIDE = 0.005;
  const onCanvasPointerMove = (e) => {
    // --- shape resize
    const rs = shapeResizingRef.current; if (rs.id) {
      const { fx, fy } = getRel(e.clientX, e.clientY);
      const s = rs.start; let L = s.fx, T = s.fy, R = s.fx + s.fw, B = s.fy + s.fh;
      const clampEdge = (v) => clamp01(v);
      switch (rs.handle) {
        case 'nw': L = clampEdge(fx); T = clampEdge(fy); break;
        case 'ne': R = clampEdge(fx); T = clampEdge(fy); break;
        case 'sw': L = clampEdge(fx); B = clampEdge(fy); break;
        case 'se': R = clampEdge(fx); B = clampEdge(fy); break;
        case 'n':  T = clampEdge(fy); break;
        case 's':  B = clampEdge(fy); break;
        case 'w':  L = clampEdge(fx); break;
        case 'e':  R = clampEdge(fx); break;
        default: break;
      }
      L = Math.max(0, Math.min(L, 1)); R = Math.max(0, Math.min(R, 1));
      T = Math.max(0, Math.min(T, 1)); B = Math.max(0, Math.min(B, 1));
      if (R - L < MIN_SIDE) { if (rs.handle.includes('w')) L = R - MIN_SIDE; else R = L + MIN_SIDE; }
      if (B - T < MIN_SIDE) { if (rs.handle.includes('n')) T = B - MIN_SIDE; else B = T + MIN_SIDE; }
      const nextRect = { fx: Math.min(L, R), fy: Math.min(T, B), fw: Math.abs(R - L), fh: Math.abs(B - T) };
      setLayer(rs.kind, (prev) => prev.map((r) => (r.id === rs.id ? { ...r, ...nextRect } : r)));
      return;
    }

    // --- item resize
    const rsz = resizingRef.current; if (rsz.id) {
      const it = items.find((i) => i.id === rsz.id); if (!it) return;
      const delta = Math.max(e.clientX - rsz.startX, e.clientY - rsz.startY);
      const newSize = Math.max(16, Math.min(256, Math.round((rsz.startSize || 48) + delta)));
      setItems((prev) => prev.map((x) => (x.id === rsz.id ? { ...x, size: newSize } : x)));
      return;
    }

    // --- shape drag
    const sd = shapeDraggingRef.current; if (sd.id) {
      const { fx, fy } = getRel(e.clientX, e.clientY);
      let newFx = clamp01(fx - sd.offsetFx), newFy = clamp01(fy - sd.offsetFy);
      newFx = Math.max(0, Math.min(1 - sd.fw, newFx)); newFy = Math.max(0, Math.min(1 - sd.fh, newFy));
      setLayer(sd.kind, (prev) => prev.map((r) => (r.id === sd.id ? { ...r, fx: newFx, fy: newFy } : r)));
      return;
    }

    // --- item drag
    const drag = draggingRef.current; if (drag.id) {
      const { fx, fy } = getRel(e.clientX, e.clientY);
      setItems((prev) => prev.map((it) => (it.id === drag.id ? { ...it, fx: clamp01(fx - drag.offsetFx), fy: clamp01(fy - drag.offsetFy) } : it)));
      return;
    }

    // --- live draft preview
    if (activeTool && selecting && draft) { const { fx, fy } = getRel(e.clientX, e.clientY); setDraft((d) => ({ ...d, end: { fx, fy } })); }

    // Pan with space/middle button
    if (panDragRef.current.active) { setBgPan({ x: panDragRef.current.origX + (e.clientX - panDragRef.current.startX), y: panDragRef.current.origY + (e.clientY - panDragRef.current.startY) }); return; }

    // Pinch-to-zoom with two touches
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
          const prevMid = onCanvasPointerMove._lastMid || { x: midX, y: midY };
          setBgPan((p) => ({ x: p.x + (midX - prevMid.x), y: p.y + (midY - prevMid.y) }));
          onCanvasPointerMove._lastMid = { x: midX, y: midY };
        }
        onCanvasPointerMove._lastDist = dist;
      }
    }
  };

  const onCanvasPointerUp = (e) => {
    // finish shape resize
    const rs = shapeResizingRef.current; if (rs.id) {
      const before = rs.startLayer; shapeResizingRef.current = { kind: null, id: null, handle: null, start: null, startLayer: null };
      const after = getLayer(rs.kind);
      const changed = before && JSON.stringify(before) !== JSON.stringify(after);
      if (changed) snapshotLayer(rs.kind, after);
    }

    // finish item resize
    const rsz = resizingRef.current; if (rsz.id) {
      resizingRef.current = { id: null, startSize: 0, startX: 0, startY: 0 };
      const before = dragStartSnapshotRef.current || []; const changed = JSON.stringify(before) !== JSON.stringify(items);
      if (changed) snapshotItems(items); dragStartSnapshotRef.current = null;
    }

    // finish shape drag
    const sd = shapeDraggingRef.current; if (sd.id) {
      const before = sd.start; shapeDraggingRef.current = { kind: null, id: null, offsetFx: 0, offsetFy: 0, fw: 0, fh: 0, start: null };
      const after = getLayer(sd.kind);
      const changed = before && JSON.stringify(before) !== JSON.stringify(after);
      if (changed) snapshotLayer(sd.kind, after);
    }

    // finish item drag
    const drag = draggingRef.current; if (drag.id != null) {
      draggingRef.current = { id: null, offsetFx: 0, offsetFy: 0 };
      const before = dragStartSnapshotRef.current || []; const changed = JSON.stringify(before) !== JSON.stringify(items);
      if (changed) snapshotItems(items); dragStartSnapshotRef.current = null;
    }

    if (panDragRef.current.active) { panDragRef.current.active = false; scheduleBgSnapshot(); }
    pointersRef.current.delete(e.pointerId);
    onCanvasPointerMove._lastDist = null; onCanvasPointerMove._lastMid = null;
  };

  const onCanvasPointerCancel = (e) => { pointersRef.current.delete(e.pointerId); panDragRef.current.active = false; onCanvasPointerMove._lastDist = null; onCanvasPointerMove._lastMid = null; shapeResizingRef.current = { kind: null, id: null, handle: null, start: null, startLayer: null }; };
  const onCanvasPointerDown = (e) => { if (e.pointerType === "touch") pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); const isPanKey = e.button === 1 || e.buttons === 4 || e.getModifierState?.("Space"); if (isPanKey) { e.preventDefault(); panDragRef.current = { active: true, startX: e.clientX, startY: e.clientY, origX: bgPan.x, origY: bgPan.y }; } };

  // Scale background
  const scheduleBgSnapshot = (nextBgSize) => { if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current); wheelTimerRef.current = setTimeout(() => { snapshotState(items, bgUrl, nextBgSize ?? bgSize, walls, windows, floors); }, 300); };
  const applyZoomAt = (screenX, screenY, factor) => {
    setBgSize((s) => {
      const nextScale = Math.min(5, Math.max(0.2, s.scale * factor));
      const dispW = s.baseW * s.scale, dispH = s.baseH * s.scale;
      const { left, top, width: cw, height: ch } = getCanvasRect(canvasRef.current);
      const beforeDx = Math.floor((cw - dispW) / 2) + Math.round(bgPan.x);
      const beforeDy = Math.floor((ch - dispH) / 2) + Math.round(bgPan.y);
      const offsetX = screenX - (left + beforeDx), offsetY = screenY - (top + beforeDy);
      const scaleRatio = nextScale / s.scale;
      setBgPan((p) => ({ x: p.x - offsetX * (scaleRatio - 1), y: p.y - offsetY * (scaleRatio - 1) }));
      const next = { ...s, scale: nextScale }; scheduleBgSnapshot(next); return next;
    });
  };
  const onCanvasWheel = (e) => { if (!bgUrl || !(e.shiftKey || e.ctrlKey)) return; e.preventDefault(); const { left, top } = getCanvasRect(canvasRef.current); const factor = 1 + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey && e.ctrlKey ? 0.15 : 0.1); applyZoomAt(e.clientX - left, e.clientY - top, factor); };
  const nudgeZoom = (m) => { if (!bgUrl) return; const { left, top, width, height } = getCanvasRect(canvasRef.current); applyZoomAt(left + width / 2, top + height / 2, m); };

  // Toolbar actions
  const clearAll = () => snapshotState([], bgUrl, bgSize, [], [], []);
  const removeItem = (id) => snapshotItems(items.filter((it) => it.id !== id));
  const clearBackground = () => { const reset = { baseW: 0, baseH: 0, naturalW: 0, naturalH: 0, scale: 1 }; if (lastBgUrlRef.current) { try { URL.revokeObjectURL(lastBgUrlRef.current); } catch {} lastBgUrlRef.current = null; } snapshotState(items, null, reset, walls, windows, floors); };

  async function saveCompositionImage() {
    try {
      if (!canvasRef.current) return;
      const { bgDx, bgDy, dispW, dispH } = getRefFrame();
      const exportOnlyBgArea = Boolean(bgUrl && dispW > 0 && dispH > 0);
      const outW = exportOnlyBgArea ? Math.round(dispW) : Math.max(1, Math.floor(canvasRef.current.getBoundingClientRect().width));
      const outH = exportOnlyBgArea ? Math.round(dispH) : Math.max(1, Math.floor(canvasRef.current.getBoundingClientRect().height));
      const canvas = document.createElement("canvas");
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      canvas.width = outW * dpr; canvas.height = outH * dpr; canvas.style.width = `${outW}px`; canvas.style.height = `${outH}px`;
      const ctx = canvas.getContext("2d"); if (!ctx) return; ctx.scale(dpr, dpr);
      if (!exportOnlyBgArea) { ctx.fillStyle = "#faf9f5"; ctx.fillRect(0, 0, outW, outH); }
      if (bgUrl && dispW > 0 && dispH > 0) {
        await new Promise((resolve) => { const img = new Image(); img.onload = () => { const x = exportOnlyBgArea ? 0 : Math.round(bgDx); const y = exportOnlyBgArea ? 0 : Math.round(bgDy); ctx.drawImage(img, x, y, Math.round(dispW), Math.round(dispH)); resolve(); }; img.onerror = resolve; img.src = bgUrl; });
      }
      const { refW, refH } = getRefFrame();

      const drawRects = (list, color) => {
        ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = color; ctx.strokeStyle = color;
        for (const r of list) {
          const leftPx = Math.round((r.fx || 0) * refW), topPx = Math.round((r.fy || 0) * refH);
          const wPx = Math.round((r.fw || 0) * refW), hPx = Math.round((r.fh || 0) * refH);
          const drawX = exportOnlyBgArea ? leftPx - Math.round(bgDx) : leftPx;
          const drawY = exportOnlyBgArea ? topPx - Math.round(bgDy) : topPx;
          ctx.fillRect(drawX, drawY, wPx, hPx); ctx.strokeRect(drawX, drawY, wPx, hPx);
        }
        ctx.restore();
      };

      drawRects(floors, '#0a28a0');
      drawRects(walls, '#ff4da6');
      drawRects(windows, '#00a050');

      // Items
      for (const it of items) {
        const node = document.getElementById(it.id); if (!node) continue; const svg = node.querySelector("svg"); if (!svg) continue;
        const onScreenLeft = Math.round((it.fx || 0) * refW), onScreenTop = Math.round((it.fy || 0) * refH);
        const left = exportOnlyBgArea ? onScreenLeft - Math.round(bgDx) : onScreenLeft;
        const top = exportOnlyBgArea ? onScreenTop - Math.round(bgDy) : onScreenTop;
        const clone = svg.cloneNode(true); const svgStr = new XMLSerializer().serializeToString(clone);
        const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" }); const url = URL.createObjectURL(blob);
        const sizePx = Math.max(16, Math.min(256, it.size || 48));
        await new Promise((resolve) => { const img = new Image(); img.onload = () => { ctx.drawImage(img, left, top, sizePx, sizePx); URL.revokeObjectURL(url); resolve(); }; img.onerror = () => { URL.revokeObjectURL(url); resolve(); }; img.src = url; });
      }
      const a = document.createElement("a"); a.href = canvas.toDataURL("image/png"); a.download = exportOnlyBgArea ? "composition-transparent.png" : "composition.png"; document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { console.error("saveCompositionImage failed", err); alert("Could not save the composition image."); }
  }

  // Undo/Redo
  const undo = () => { if (!canUndo) return; const newIdx = hIndex - 1; setHIndex(newIdx); const s = history[newIdx]; setItems(deepClone(s.items)); setWalls(deepClone(s.walls || [])); setWindows(deepClone(s.windows || [])); setFloors(deepClone(s.floors || [])); setBgUrl(s.bgUrl); setBgSize({ ...s.bgSize }); };
  const redo = () => { if (!canRedo) return; const newIdx = hIndex + 1; setHIndex(newIdx); const s = history[newIdx]; setItems(deepClone(s.items)); setWalls(deepClone(s.walls || [])); setWindows(deepClone(s.windows || [])); setFloors(deepClone(s.floors || [])); setBgUrl(s.bgUrl); setBgSize({ ...s.bgSize }); };

  // Keyboard shortcuts
  const undoRef = useRef(undo), redoRef = useRef(redo);
  useEffect(() => { undoRef.current = undo; redoRef.current = redo; });
  useEffect(() => { const onKeyDown = (e) => { const mod = e.ctrlKey || e.metaKey; if (!mod) return; const k = e.key.toLowerCase(); if (k === "z" && !e.shiftKey) { e.preventDefault(); undoRef.current(); } else if (k === "z" && e.shiftKey) { e.preventDefault(); redoRef.current(); } else if (k === "y") { e.preventDefault(); redoRef.current(); } }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, []);

  // Rerender on resize
  useEffect(() => { const onResize = () => forceResizeTick((t) => t + 1); window.addEventListener("resize", onResize); return () => window.removeEventListener("resize", onResize); }, []);

  // Runtime smoke tests (trimmed)
  useEffect(() => { try { const ok = JSON.stringify(fitWithin(1000, 1000, 500, 1000)) === JSON.stringify({ w: 500, h: 500 }); if (!ok) console.warn("fitWithin test failed"); } catch {} }, []);

  const defocusActive = () => { const ae = document.activeElement; if (ae && typeof ae.blur === "function" && ae !== document.body) ae.blur(); };

  const { refW, refH } = getRefFrame();

  // ---------- Small components ----------
  const Handles = ({ kind, r }) => {
    if (!selecting) return null; // hide handles when not selecting
    const leftPx = Math.round((r.fx || 0) * refW), topPx = Math.round((r.fy || 0) * refH);
    const wPx = Math.round((r.fw || 0) * refW), hPx = Math.round((r.fh || 0) * refH);
    const cx = leftPx + wPx / 2, cy = topPx + hPx / 2;
    const color = colorFor(kind);
    const mk = (pos, styleExtra, cursor) => (
      <div
        key={pos}
        role="button"
        aria-label={`Resize ${pos}`}
        style={{ ...styles.wallHandle(color), ...styleExtra, cursor }}
        onPointerDown={(e) => onShapeHandlePointerDown(e, kind, r.id, pos)}
      />
    );
    return (
      <>
        {mk('nw', { left: leftPx - 6, top: topPx - 6 }, 'nwse-resize')}
        {mk('ne', { left: leftPx + wPx - 6, top: topPx - 6 }, 'nesw-resize')}
        {mk('sw', { left: leftPx - 6, top: topPx + hPx - 6 }, 'nesw-resize')}
        {mk('se', { left: leftPx + wPx - 6, top: topPx + hPx - 6 }, 'nwse-resize')}
        {mk('n',  { left: cx - 6, top: topPx - 6 }, 'ns-resize')}
        {mk('s',  { left: cx - 6, top: topPx + hPx - 6 }, 'ns-resize')}
        {mk('w',  { left: leftPx - 6, top: cy - 6 }, 'ew-resize')}
        {mk('e',  { left: leftPx + wPx - 6, top: cy - 6 }, 'ew-resize')}
      </>
    );
  };

  const RectLayer = ({ kind }) => {
    const list = getLayer(kind);
    const rectStyle = kind === 'wall' ? styles.rect_wall : kind === 'window' ? styles.rect_window : styles.rect_floor;
    const draftStyle = kind === 'wall' ? styles.draft_wall : kind === 'window' ? styles.draft_window : styles.draft_floor;
    return (
      <>
        {list.map((r) => {
          const leftPx = Math.round((r.fx || 0) * refW), topPx = Math.round((r.fy || 0) * refH);
          const wPx = Math.round((r.fw || 0) * refW), hPx = Math.round((r.fh || 0) * refH);
          return (
            <React.Fragment key={r.id}>
              <div
                style={{ ...rectStyle, left: leftPx, top: topPx, width: wPx, height: hPx }}
                onPointerDown={(e) => onShapeBodyPointerDown(e, kind, r.id)}
                aria-label={kind}
              />
              <Handles kind={kind} r={r} />
            </React.Fragment>
          );
        })}
        {activeTool === kind && selecting && draft && (() => { const r = normRect(draft.start.fx, draft.start.fy, draft.end.fx, draft.end.fy); const leftPx = Math.round(r.fx * refW), topPx = Math.round(r.fy * refH); const wPx = Math.round(r.fw * refW), hPx = Math.round(r.fh * refH); return <div style={{ ...draftStyle, left: leftPx, top: topPx, width: wPx, height: hPx }} />; })()}
      </>
    );
  };

  const Items = () => (
    <>
      {items.map((it) => {
        const left = Math.round((it.fx || 0) * refW), top = Math.round((it.fy || 0) * refH);
        const scale = Math.max(16, Math.min(256, it.size || 48)) / 48;
        const sizePx = Math.max(16, Math.min(256, it.size || 48));
        return (
          <React.Fragment key={it.id}>
            <div
              id={it.id}
              style={{ ...styles.placed, left, top, transform: `scale(${scale})`, transformOrigin: "top left" }}
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
              style={{ position: "absolute", left: left + sizePx - 6, top: top + sizePx - 6, zIndex: 11, ...styles.resizeHandle }}
              onPointerDown={(e) => { e.stopPropagation(); onItemResizePointerDown(e, it.id); }}
              onClickCapture={(e) => e.stopPropagation()}
            >
              <span style={styles.resizeGlyph}>↘︎</span>
            </div>
          </React.Fragment>
        );
      })}
    </>
  );

  // UI helpers
  const ActiveLabel = activeTool ? (activeTool === 'wall' ? 'Walls' : activeTool === 'window' ? 'Windows' : 'Floor') : 'None';

  return (
    <div style={styles.app} tabIndex={-1} onMouseDown={defocusActive}>
      {/* Toolbar */}
      <div style={styles.floaterBar}>
        <button aria-label="Save as image" style={styles.floaterBtn} title="Save as image" onClick={saveCompositionImage}>⬇️</button>
        <button aria-label="Zoom out" style={styles.floaterBtn} title="Zoom out" onClick={() => nudgeZoom(1 / 1.1)}>−</button>
        <button aria-label="Zoom in" style={styles.floaterBtn} title="Zoom in" onClick={() => nudgeZoom(1.1)}>＋</button>
        <button aria-label="Clear items/walls" style={styles.floaterBtn} title="Clear items & walls" onClick={clearAll}>🧹</button>
        <button aria-label="Remove background" style={styles.floaterBtn} title="Remove background" onClick={clearBackground}>🗑️</button>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={onInputChange} hidden />
      </div>

      {/* Right-center controls: Select + Stop selecting */}
      <div style={styles.selectStack}>
        <div style={styles.selectBtn(selectOpen)}>
          <div style={styles.selectHeader(selectOpen, ActiveLabel)} onClick={toggleSelect} role="button" aria-label="Select tool">
            Select {selecting && activeTool ? `• ${ActiveLabel}` : ''}
          </div>
          {selectOpen && (
            <div style={styles.selectMenu}>
              <div style={styles.selectItem(activeTool==='wall', '#ff4da6')} onClick={() => chooseTool('wall')}>Walls</div>
              <div style={styles.selectItem(activeTool==='window', '#00a050')} onClick={() => chooseTool('window')}>Windows</div>
              <div style={styles.selectItem(activeTool==='floor', '#0a28a0')} onClick={() => chooseTool('floor')}>Floor</div>
            </div>
          )}
        </div>
        <button style={styles.stopBtn} onClick={stopSelecting} aria-label="Stop selecting">Stop selecting</button>
      </div>

      {/* Toggle palette handle */}
      <button aria-label="Toggle palette" onClick={() => setSidebarOpen((v) => !v)} style={styles.handle}>{sidebarOpen ? "‹" : "›"}</button>

      {/* Sidebar / Palette */}
      <aside style={styles.sidebar(sidebarOpen)} aria-hidden={!sidebarOpen}>
        {PALETTE.map((p) => (
          <div key={p.type} draggable onDragStart={(e) => onPaletteDragStart(e, p.type)} style={styles.paletteCard} title={`Drag ${p.label}`}>
            {Icon[p.type](48)}
            <div style={{ fontSize: 14 }}>{p.label}</div>
          </div>
        ))}
      </aside>

      {/* Canvas */}
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
          <img src={bgUrl} alt="Background" draggable={false} onDragOver={onCanvasDragOver} onDragEnter={onCanvasDragOver} onDrop={onCanvasDrop} style={{ width: Math.max(0, Math.round(bgSize.baseW * bgSize.scale)), height: Math.max(0, Math.round(bgSize.baseH * bgSize.scale)), objectFit: "contain", background: "#fff", borderRadius: 12 }} />
        ) : (
          <div style={{ textAlign: "center", color: "#666" }}>
            <div style={{ fontSize: 18, marginBottom: 6 }}>Drop an image anywhere</div>
            <div style={{ fontSize: 13, marginBottom: 12, opacity: .8 }}>or</div>
            <button onClick={() => fileInputRef.current?.click()} style={styles.topChooseBtn}>Choose a file</button>
          </div>
        )}

        {/* Floors at the very bottom, then walls, then windows, then items */}
        <RectLayer kind="floor" />
        <RectLayer kind="wall" />
        <RectLayer kind="window" />

        <Items />
      </div>

      {/* Undo / Redo */}
      <div style={styles.undoRedoBar}>
        <button aria-label="Undo" style={styles.undoRedoBtn(canUndo)} onClick={undo} disabled={!canUndo} title="Undo (Ctrl/⌘+Z)">↩︎ Undo</button>
        <button aria-label="Redo" style={styles.undoRedoBtn(canRedo)} onClick={redo} disabled={!canRedo} title="Redo (Ctrl/⌘+Y or Shift+Ctrl/⌘+Z)">Redo ↪︎</button>
      </div>

      {/* Info */}
      <button type="button" aria-label="Show tips" style={styles.infoBtn} onClick={() => setShowInfo((v) => !v)}>ℹ️</button>
      {showInfo && (
        <div style={styles.infoBox}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Tips</div>
          <div>
            On desktop, hold <kbd>Shift</kbd> or <kbd>Ctrl/Cmd</kbd> and scroll to zoom the background. On touch devices, use the ＋/− buttons.
            Double‑click an item to delete it. Hold <kbd>Space</kbd> and drag to pan.
            <br />Draw rectangles: click <strong>Select</strong> on the right, choose <em>Walls</em> (pink), <em>Windows</em> (green), or <em>Floor</em> (dark blue). Click to start and click again to finish. Drag handles to resize.
          </div>
        </div>
      )}
    </div>
  );
}
