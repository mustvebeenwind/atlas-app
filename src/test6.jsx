import React, { useEffect, useMemo, useRef, useState } from "react";

/* ---------- tiny utils ---------- */
const isPlainObject = (x) =>
  !!x &&
  typeof x === "object" &&
  (Object.getPrototypeOf(x) === Object.prototype ||
    Object.getPrototypeOf(x) === null);
const merge = (o, p) => ({ ...(isPlainObject(o) ? o : {}), ...(isPlainObject(p) ? p : {}) });
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const fitWithin = (w, h, maxW, maxH) => {
  const r = Math.min(maxW / Math.max(1, w), maxH / Math.max(1, h));
  return { w: Math.round(w * r), h: Math.round(h * r) };
};
const getRect = (el) => {
  if (!el) return { left: 0, top: 0, width: 0, height: 0 };
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

/* ---------- visuals ---------- */
const COLORS = {
  wall:   { fill: "rgba(255,77,166,0.35)", stroke: "rgba(255,77,166,0.85)" },
  window: { fill: "rgba(0,160,80,0.35)",  stroke: "rgba(0,160,80,0.85)"  },
  floor:  { fill: "rgba(10,40,160,0.35)", stroke: "rgba(10,40,160,0.9)"  },
};

const stroke = "#333";
const S = { fill: "none", stroke, strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" };
const Icon = {
  bed:   (s=48)=>(<svg width={s} height={s} viewBox="0 0 64 64"><rect x="6" y="30" width="52" height="18" rx="3" {...S}/><rect x="10" y="24" width="22" height="10" rx="2" {...S}/><line x1="6" y1="48" x2="6" y2="54" {...S}/><line x1="58" y1="48" x2="58" y2="54" {...S}/></svg>),
  door:  (s=48)=>(<svg width={s} height={s} viewBox="0 0 64 64"><rect x="18" y="6" width="28" height="52" rx="2" {...S}/><circle cx="40" cy="32" r="2.5" stroke={stroke} fill={stroke}/></svg>),
  table: (s=48)=>(<svg width={s} height={s} viewBox="0 0 64 64"><rect x="10" y="22" width="44" height="8" rx="2" {...S}/><line x1="18" y1="30" x2="18" y2="50" {...S}/><line x1="46" y1="30" x2="46" y2="50" {...S}/></svg>),
  chair: (s=48)=>(<svg width={s} height={s} viewBox="0 0 64 64"><rect x="22" y="14" width="20" height="14" rx="2" {...S}/><rect x="22" y="28" width="20" height="8" {...S}/><line x1="24" y1="36" x2="24" y2="50" {...S}/><line x1="40" y1="36" x2="40" y2="50" {...S}/></svg>),
};
const PALETTE = ["bed", "door", "table", "chair"].map((t) => ({ type: t, label: t[0].toUpperCase() + t.slice(1) }));
let idCounter = 1;
const nextId = () => `item_${idCounter++}`;

/* ---------- styles ---------- */
const styles = {
  app: {
    width: "100vw", height: "100vh",
    background: "#faf9f5", color: "#333",
    fontFamily: "Inter, system-ui, Arial, sans-serif",
    position: "relative", userSelect: "none", overflow: "hidden",
  },
  sidebar: {
    position: "absolute", top: 0, left: 0, bottom: 0, width: 180,
    background: "#faf9f5", borderRight: "1px solid rgba(0,0,0,.1)",
    padding: 12, display: "flex", flexDirection: "column", gap: 12, zIndex: 50,
  },
  paletteCard: {
    background: "transparent", border: "1px solid rgba(0,0,0,.1)", borderRadius: 12,
    padding: 10, display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", gap: 6, cursor: "pointer", textAlign: "center",
  },
  floaterBar: { position: "absolute", top: 12, right: 12, display: "flex", gap: 8, zIndex: 40 },
  floaterBtn: {
    width: 44, height: 44, borderRadius: 22, background: "rgba(0,0,0,0)",
    border: "1px solid rgba(0,0,0,0.2)", cursor: "pointer", display: "flex",
    alignItems: "center", justifyContent: "center",
  },
  undoRedoBar: { position: "absolute", left: "50%", bottom: 16, transform: "translateX(-50%)", display: "flex", gap: 10, zIndex: 45 },
  undoRedoBtn: (ena) => ({
    minWidth: 72, height: 40, padding: "0 14px", borderRadius: 10,
    background: "rgba(0,0,0,0.03)", border: `1px solid rgba(0,0,0,${ena ? 0.25 : 0.12})`,
    color: ena ? "#222" : "#999", cursor: ena ? "pointer" : "not-allowed",
    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
  }),
  stack: { position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", zIndex: 46, width: 160, display: "flex", flexDirection: "column", gap: 8 },
  selectBtn: { width: "100%", minHeight: 44, borderRadius: 14, border: "1px solid rgba(0,0,0,0.2)", background: "#fff", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 },
  stopBtn: { width: "100%", minHeight: 40, borderRadius: 12, border: "1px solid rgba(0,0,0,0.2)", background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 },
  topChooseBtn: { fontSize: 14, cursor: "pointer", background: "transparent", color: "#666", border: "1px solid rgba(0,0,0,0.2)", padding: "10px 14px", borderRadius: 10, lineHeight: 1.2 },

  canvas: { position: "relative", width: "100%", height: "100%", overflow: "hidden" },

  /* World: visible even without a background image */
  world: {
    position: "absolute", transformOrigin: "top left",
    background: "#faf9f5", /* same as app background */
    border: "1px dashed rgba(0,0,0,0.15)", /* so you see it */
  },

  /* Background image (optional) */
  bgImg: { position: "absolute", left: 0, top: 0, objectFit: "contain" },

  rect: (b, s) => ({ position: "absolute", background: b, border: `2px solid ${s}`, borderRadius: 0, cursor: "move" }),
  draft: (b, s) => ({ position: "absolute", background: b, border: `2px dashed ${s}`, borderRadius: 0, pointerEvents: "none" }),

  placed: { position: "absolute", touchAction: "none", userSelect: "none", cursor: "grab", zIndex: 10, outline: "none" },

  note: {
    position: "absolute", left: "50%", bottom: 64, transform: "translateX(-50%)",
    background: "#fff", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 10,
    padding: "8px 12px", fontSize: 13, color: "#0a0a0a",
    boxShadow: "0 2px 6px rgba(0,0,0,0.08)", zIndex: 48,
  },
};

/* ---------- component ---------- */
export default function ImageCanvasApp() {
  /* world + pan/zoom */
  const canvasRef = useRef(null);
  const [world, setWorld] = useState({ w: 0, h: 0, scale: 1 });
  const [pan, setPan] = useState({ x: 0, y: 0 });

  /* init world immediately so something is visible */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const r = getRect(el);
    if (r.width && r.height) {
      const w = Math.floor(r.width * 0.8);
      const h = Math.floor(r.height * 0.8);
      setWorld({ w, h, scale: 1 });
      setPan({ x: 0, y: 0 });
    }
  }, []);

  /* keep centered on resize */
  useEffect(() => {
    if (!canvasRef.current) return;
    let prev = getRect(canvasRef.current);
    const ro = new ResizeObserver(() => {
      const rect = getRect(canvasRef.current);
      if (!rect.width || !rect.height) return;
      if (world.w === 0 || world.h === 0) {
        setWorld({ w: Math.floor(rect.width * 0.8), h: Math.floor(rect.height * 0.8), scale: 1 });
        setPan({ x: 0, y: 0 });
      } else {
        const dx = (rect.width - prev.width) / 2;
        const dy = (rect.height - prev.height) / 2;
        if (dx || dy) setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      }
      prev = rect;
    });
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [world.w, world.h]);

  /* background image (optional) */
  const [bgUrl, setBgUrl] = useState(null);
  const lastBgUrlRef = useRef(null);
  const [bgImg, setBgImg] = useState({ w: 0, h: 0 });
  const fileInputRef = useRef(null);

  const bgOffset = useMemo(
    () => ({ x: (world.w - bgImg.w) / 2, y: (world.h - bgImg.h) / 2 }),
    [world.w, world.h, bgImg.w, bgImg.h]
  );

  const onFile = (file) => {
    if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const fit = fitWithin(img.width, img.height, Math.max(100, Math.floor(world.w * 0.7)), Math.max(100, Math.floor(world.h * 0.7)));
        if (lastBgUrlRef.current && lastBgUrlRef.current !== url) {
          try { URL.revokeObjectURL(lastBgUrlRef.current); } catch {}
        }
        lastBgUrlRef.current = url;
        setBgUrl(url);
        setBgImg({ w: fit.w, h: fit.h });
      };
      img.src = url;
    } catch {}
  };
  const onInputChange = (e) => {
    const f = e?.target?.files?.[0];
    if (f) onFile(f);
    try { e.target.value = ""; } catch {}
  };

  /* layers & items */
  const [walls, setWalls] = useState([]);
  const [windows, setWindows] = useState([]);
  const [floors, setFloors] = useState([]);
  const [items, setItems] = useState([]);

  /* tools & draft */
  const [activeTool, setActiveTool] = useState(null); // 'wall' | 'window' | 'floor'
  const [selecting, setSelecting] = useState(false);
  const [draft, setDraft] = useState(null);

  /* click-to-place palette mode (no DnD required) */
  const [armedType, setArmedType] = useState(null); // e.g. 'bed' etc.

  /* history */
  const [history, setHistory] = useState([{ items: [], walls: [], windows: [], floors: [], bgUrl: null, bgImg: { w: 0, h: 0 }, world: { w: 0, h: 0, scale: 1 }, pan: { x: 0, y: 0 } }]);
  const [hIndex, setHIndex] = useState(0);
  const canUndo = hIndex > 0, canRedo = hIndex < history.length - 1;

  const snapshot = (next = {}) => {
    const snap = { items, walls, windows, floors, bgUrl, bgImg, world: { ...world }, pan: { ...pan }, ...next };
    setHistory((prev) => {
      const trimmed = prev.slice(0, hIndex + 1);
      const newHist = [...trimmed, JSON.parse(JSON.stringify(snap))];
      setHIndex(newHist.length - 1);
      return newHist;
    });
    if (next.items) setItems(next.items);
    if (next.walls) setWalls(next.walls);
    if (next.windows) setWindows(next.windows);
    if (next.floors) setFloors(next.floors);
    if (Object.prototype.hasOwnProperty.call(next, "bgUrl")) setBgUrl(next.bgUrl);
    if (next.bgImg) setBgImg(next.bgImg);
    if (next.world) setWorld(next.world);
    if (next.pan) setPan(next.pan);
  };

  /* frame helpers */
  const frame = useMemo(() => {
    const { left, top, width: cw, height: ch } = getRect(canvasRef.current);
    const dispW = world.w * world.scale;
    const dispH = world.h * world.scale;
    const worldLeft = Math.floor((cw - dispW) / 2) + Math.round(pan.x);
    const worldTop = Math.floor((ch - dispH) / 2) + Math.round(pan.y);
    return { left, top, cw, ch, worldLeft, worldTop, dispW, dispH };
  }, [canvasRef.current, world.w, world.h, world.scale, pan.x, pan.y]);

  const screenToWorld = (clientX, clientY) => {
    const x = (clientX - (frame.left + frame.worldLeft)) / Math.max(0.0001, world.scale);
    const y = (clientY - (frame.top + frame.worldTop)) / Math.max(0.0001, world.scale);
    return { x, y };
  };

  /* dragging */
  const draggingItemRef = useRef({ id: null, dx: 0, dy: 0 });
  const draggingRectRef = useRef({ kind: null, id: null, dx: 0, dy: 0, start: null });
  const panDragRef = useRef({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 });

  const onWorldPointerDown = (e) => {
    const panKey = e.button === 1 || e.buttons === 4 || e.getModifierState?.("Space");
    if (panKey) {
      e.preventDefault();
      panDragRef.current = { active: true, sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
      return;
    }
  };
  const onPointerMove = (e) => {
    if (panDragRef.current.active) {
      setPan({ x: panDragRef.current.ox + (e.clientX - panDragRef.current.sx), y: panDragRef.current.oy + (e.clientY - panDragRef.current.sy) });
      return;
    }
    const di = draggingItemRef.current;
    if (di.id) {
      const pt = screenToWorld(e.clientX, e.clientY);
      setItems((prev) => prev.map((it) => (it.id === di.id ? merge(it, { x: pt.x - di.dx, y: pt.y - di.dy }) : it)));
      return;
    }
    const dr = draggingRectRef.current;
    if (dr.id) {
      const pt = screenToWorld(e.clientX, e.clientY);
      const nx = pt.x - dr.dx, ny = pt.y - dr.dy;
      if (dr.kind === "wall") setWalls((p) => p.map((r) => (r.id === dr.id ? merge(r, { x: nx, y: ny }) : r)));
      if (dr.kind === "window") setWindows((p) => p.map((r) => (r.id === dr.id ? merge(r, { x: nx, y: ny }) : r)));
      if (dr.kind === "floor") setFloors((p) => p.map((r) => (r.id === dr.id ? merge(r, { x: nx, y: ny }) : r)));
      return;
    }
    if (activeTool && selecting && draft) {
      const pt = screenToWorld(e.clientX, e.clientY);
      setDraft((d) => ({ ...d, end: { x: pt.x, y: pt.y } }));
    }
  };
  const onPointerUp = () => {
    if (draggingItemRef.current.id) {
      draggingItemRef.current = { id: null, dx: 0, dy: 0 };
      snapshot({ items: [...items] });
    }
    if (draggingRectRef.current.id) {
      const k = draggingRectRef.current.kind;
      draggingRectRef.current = { kind: null, id: null, dx: 0, dy: 0, start: null };
      if (k === "wall") snapshot({ walls: [...walls] });
      if (k === "window") snapshot({ windows: [...windows] });
      if (k === "floor") snapshot({ floors: [...floors] });
    }
    if (panDragRef.current.active) panDragRef.current.active = false;
  };

  const onItemPointerDown = (e, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const pt = screenToWorld(e.clientX, e.clientY);
    const it = items.find((x) => x.id === id); if (!it) return;
    draggingItemRef.current = { id, dx: pt.x - it.x, dy: pt.y - it.y };
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  };
  const onRectPointerDown = (e, kind, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const pt = screenToWorld(e.clientX, e.clientY);
    const list = kind === "wall" ? walls : kind === "window" ? windows : floors;
    const r = list.find((x) => x.id === id); if (!r) return;
    draggingRectRef.current = { kind, id, dx: pt.x - r.x, dy: pt.y - r.y, start: list };
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  };

  /* palette: click-to-arm, then click to place */
  const onWorldClick = (e) => {
    // place item if armed
    if (armedType) {
      const pt = screenToWorld(e.clientX, e.clientY);
      snapshot({ items: [...items, { id: nextId(), type: armedType, x: pt.x, y: pt.y, size: 48 }] });
      setArmedType(null);
      return;
    }
    // finish rectangle
    if (!activeTool || !selecting) return;
    const pt = screenToWorld(e.clientX, e.clientY);
    if (!draft) {
      setDraft({ start: { x: pt.x, y: pt.y }, end: { x: pt.x, y: pt.y } });
      return;
    }
    const L = Math.min(draft.start.x, pt.x), T = Math.min(draft.start.y, pt.y);
    const R = Math.max(draft.start.x, pt.x), B = Math.max(draft.start.y, pt.y);
    const rect = { id: `${activeTool}_${Date.now()}_${Math.random().toString(36).slice(2)}`, x: L, y: T, w: R - L, h: B - T };
    if (activeTool === "wall") snapshot({ walls: [...walls, rect] });
    if (activeTool === "window") snapshot({ windows: [...windows, rect] });
    if (activeTool === "floor") snapshot({ floors: [...floors, rect] });
    setDraft(null);
  };

  /* optional DnD (not required anymore) */
  const onCanvasDragOver = (e) => { e.preventDefault(); try { if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } catch {} };
  const onPaletteDragStart = (e, type) => {
    if (!e?.dataTransfer) return;
    try { e.dataTransfer.setData("text/plain", type); e.dataTransfer.setData("text", type); } catch {}
    e.dataTransfer.effectAllowed = "copy";
  };
  const onCanvasDrop = (e) => {
    e.preventDefault();
    const dt = e.dataTransfer;
    if (dt?.files?.length > 0) { const f = dt.files[0]; if (f?.type?.startsWith("image/")) onFile(f); return; }
    const type = dt.getData("text/plain") || dt.getData("text");
    if (!type) return;
    const pt = screenToWorld(e.clientX, e.clientY);
    snapshot({ items: [...items, { id: nextId(), type, x: pt.x, y: pt.y, size: 48 }] });
  };

  /* zoom (+/−), wheel (Ctrl or Shift) */
  const applyZoomAt = (clientX, clientY, factor) => {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const curr = world.scale;
    const next = Math.min(5, Math.max(0.2, curr * factor));
    if (Math.abs(next - curr) < 1e-6) return;

    const wx = (clientX - (frame.left + frame.worldLeft)) / curr;
    const wy = (clientY - (frame.top + frame.worldTop)) / curr;

    const newWorldLeft = clientX - wx * next - frame.left;
    const newWorldTop = clientY - wy * next - frame.top;

    const newDispW = world.w * next;
    const newDispH = world.h * next;
    const centerLeft = (frame.cw - newDispW) / 2;
    const centerTop = (frame.ch - newDispH) / 2;

    const newPan = { x: newWorldLeft - centerLeft, y: newWorldTop - centerTop };
    setPan(newPan);
    setWorld((w) => ({ ...w, scale: next }));
  };
  const onWheel = (e) => {
    if (!(e.ctrlKey || e.shiftKey)) return;
    e.preventDefault();
    const factor = 1 + (e.deltaY < 0 ? 1 : -1) * (e.ctrlKey && e.shiftKey ? 0.15 : 0.1);
    applyZoomAt(e.clientX, e.clientY, factor);
  };
  const nudgeZoom = (m) => applyZoomAt(frame.left + frame.cw / 2, frame.top + frame.ch / 2, m);

  /* undo/redo */
  const undo = () => {
    if (!canUndo) return;
    const i = hIndex - 1; setHIndex(i);
    const s = history[i];
    setItems(s.items); setWalls(s.walls); setWindows(s.windows); setFloors(s.floors);
    setBgUrl(s.bgUrl); setBgImg(s.bgImg); setWorld(s.world); setPan(s.pan);
  };
  const redo = () => {
    if (!canRedo) return;
    const i = hIndex + 1; setHIndex(i);
    const s = history[i];
    setItems(s.items); setWalls(s.walls); setWindows(s.windows); setFloors(s.floors);
    setBgUrl(s.bgUrl); setBgImg(s.bgImg); setWorld(s.world); setPan(s.pan);
  };

  /* helpers */
  const chooseTool = (k) => { setActiveTool(k); setSelecting(true); setDraft(null); setArmedType(null); };
  const stopSelecting = () => { setSelecting(false); setDraft(null); };
  const clearAll = () => snapshot({ items: [], walls: [], windows: [], floors: [] });
  const clearBackground = () => {
    if (lastBgUrlRef.current) { try { URL.revokeObjectURL(lastBgUrlRef.current); } catch {} lastBgUrlRef.current = null; }
    setBgUrl(null); setBgImg({ w: 0, h: 0 });
  };

  return (
    <div style={styles.app}>
      {/* Sidebar Palette (always visible; click to arm) */}
      <aside style={styles.sidebar}>
        <button className="choose" onClick={() => fileInputRef.current?.click()} style={styles.topChooseBtn}>Choose a file</button>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={onInputChange} hidden />
        {PALETTE.map((p) => (
          <div
            key={p.type}
            style={{
              ...styles.paletteCard,
              borderColor: armedType === p.type ? "#0a0" : "rgba(0,0,0,.1)",
              background: armedType === p.type ? "#eaffea" : "transparent",
            }}
            onClick={() => setArmedType((t) => (t === p.type ? null : p.type))}
            draggable
            onDragStart={(e) => onPaletteDragStart(e, p.type)}
            title={`Click to arm, then click on the canvas to place`}
          >
            {Icon[p.type]?.(48)}
            <div style={{ fontSize: 14 }}>{p.label}</div>
          </div>
        ))}
        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
          Tip: Click an icon, then click on the canvas to place it.
        </div>
      </aside>

      {/* Toolbar */}
      <div style={styles.floaterBar}>
        <button aria-label="Zoom out" style={styles.floaterBtn} title="Zoom out" onClick={() => nudgeZoom(1 / 1.1)}>−</button>
        <button aria-label="Zoom in" style={styles.floaterBtn} title="Zoom in" onClick={() => nudgeZoom(1.1)}>＋</button>
        <button aria-label="Clear items/walls" style={styles.floaterBtn} title="Clear items & walls" onClick={clearAll}>🧹</button>
        <button aria-label="Remove background" style={styles.floaterBtn} title="Remove background" onClick={clearBackground}>🗑️</button>
      </div>

      {/* Undo/Redo */}
      <div style={styles.undoRedoBar}>
        <button style={styles.undoRedoBtn(canUndo)} onClick={undo} disabled={!canUndo}>⟲ Undo</button>
        <button style={styles.undoRedoBtn(canRedo)} onClick={redo} disabled={!canRedo}>⟳ Redo</button>
      </div>

      {/* Right controls: pick draw tool, stop selecting */}
      <div style={styles.stack}>
        <div style={styles.selectBtn} onClick={() => chooseTool("wall")}>Tool: Walls</div>
        <div style={styles.selectBtn} onClick={() => chooseTool("window")}>Tool: Windows</div>
        <div style={styles.selectBtn} onClick={() => chooseTool("floor")}>Tool: Floor</div>
        <button style={styles.stopBtn} onClick={stopSelecting}>Stop selecting</button>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        style={styles.canvas}
        onClick={onWorldClick}
        onPointerDown={onWorldPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onDragOver={onCanvasDragOver}
        onDrop={onCanvasDrop}
      >
        {/* World (always visible) */}
        {world.w > 0 && world.h > 0 && (
          <div
            style={{
              ...styles.world,
              left: frame.worldLeft,
              top: frame.worldTop,
              width: world.w,
              height: world.h,
              transform: `scale(${world.scale})`,
            }}
          >
            {/* Optional background image */}
            {bgUrl ? (
              <img
                src={bgUrl}
                alt="Background"
                draggable={false}
                style={{ ...styles.bgImg, width: bgImg.w, height: bgImg.h, left: bgOffset.x, top: bgOffset.y }}
              />
            ) : null}

            {/* Floors */}
            {floors.map((r) => (
              <div
                key={r.id}
                style={{ ...styles.rect(COLORS.floor.fill, COLORS.floor.stroke), left: r.x, top: r.y, width: r.w, height: r.h }}
                onPointerDown={(e) => onRectPointerDown(e, "floor", r.id)}
              />
            ))}
            {/* Walls */}
            {walls.map((r) => (
              <div
                key={r.id}
                style={{ ...styles.rect(COLORS.wall.fill, COLORS.wall.stroke), left: r.x, top: r.y, width: r.w, height: r.h }}
                onPointerDown={(e) => onRectPointerDown(e, "wall", r.id)}
              />
            ))}
            {/* Windows */}
            {windows.map((r) => (
              <div
                key={r.id}
                style={{ ...styles.rect(COLORS.window.fill, COLORS.window.stroke), left: r.x, top: r.y, width: r.w, height: r.h }}
                onPointerDown={(e) => onRectPointerDown(e, "window", r.id)}
              />
            ))}

            {/* Items */}
            {items.map((it) => {
              const sizePx = Math.max(16, Math.min(256, num(it.size || 48)));
              const scale = sizePx / 48;
              return (
                <div
                  key={it.id}
                  style={{ ...styles.placed, left: it.x, top: it.y, transform: `scale(${scale})`, transformOrigin: "top left" }}
                  onPointerDown={(e) => onItemPointerDown(e, it.id)}
                  title={it.type}
                >
                  {Icon[it.type]?.(48)}
                </div>
              );
            })}

            {/* Draft rectangle */}
            {activeTool && selecting && draft && (() => {
              const L = Math.min(draft.start.x, draft.end.x);
              const T = Math.min(draft.start.y, draft.end.y);
              const W = Math.abs(draft.end.x - draft.start.x);
              const H = Math.abs(draft.end.y - draft.start.y);
              const { fill, stroke } = COLORS[activeTool];
              const draftFill = fill.replace("0.35", "0.2");
              return <div style={{ ...styles.draft(draftFill, stroke), left: L, top: T, width: W, height: H }} />;
            })()}
          </div>
        )}

        {/* Empty state overlay (still visible even with world) */}
        {!bgUrl && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
            <div style={{ textAlign: "center", color: "#666", pointerEvents: "auto" }}>
              <div style={{ fontSize: 18, marginBottom: 6 }}>Drop an image anywhere</div>
              <div style={{ fontSize: 13, marginBottom: 12, opacity: 0.8 }}>or</div>
              <button onClick={() => fileInputRef.current?.click()} style={styles.topChooseBtn}>Choose a file</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
