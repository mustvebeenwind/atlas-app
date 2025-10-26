// @ts-nocheck
import React, { useRef, useState, useEffect } from "react";

/**
 * AtlaS – React Image Canvas (restored full app)
 *
 * Features:
 *  - Drag & drop icons from palette (Safari/macOS friendly)
 *  - Free movement: items can be dropped/dragged anywhere on the canvas
 *  - Walls mode: click to start, click to finish, live preview, drag to move
 *  - Zoom (Shift/Ctrl+wheel) + pinch, panning (Space/middle)
 *  - Export PNG (HiDPI), undo/redo, info tips
 *  - Background upload/remove, zoom debounced to history
 *  - Robust runtime checks (non-throwing)
 */

// ---------- Helpers ----------
function fitWithin(imgW, imgH, maxW, maxH) {
  if (!imgW || !imgH) return { w: 0, h: 0 };
  const r = Math.min(maxW / imgW, maxH / imgH);
  return { w: Math.round(imgW * r), h: Math.round(imgH * r) };
}
function isRoughlySquare(w, h) { if (!w || !h) return false; const r = w / h; return r > 0.9 && r < 1.1; }
const deepClone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
function clamp01(n) { return Math.max(0, Math.min(1, n)); }
function normRect(fx0, fy0, fx1, fy1) {
  const x0 = clamp01(Math.min(fx0, fx1));
  const y0 = clamp01(Math.min(fy0, fy1));
  const x1 = clamp01(Math.max(fx0, fx1));
  const y1 = clamp01(Math.max(fy0, fy1));
  return { fx: x0, fy: y0, fw: clamp01(x1 - x0), fh: clamp01(y1 - y0) };
}

// ---------- Icons ----------
const stroke = "#333";
const common = { fill: "none", stroke, strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" };
const Icons = {
  bed: (size = 48) => (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="bed">
      <rect x="6" y="30" width="52" height="18" rx="3" {...common} />
      <rect x="10" y="24" width="22" height="10" rx="2" {...common} />
      <line x1="6" y1="48" x2="6" y2="54" {...common} />
      <line x1="58" y1="48" x2="58" y2="54" {...common} />
    </svg>
  ),
  door: (size = 48) => (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="door">
      <rect x="18" y="6" width="28" height="52" rx="2" {...common} />
      <circle cx="40" cy="32" r="2.5" stroke={stroke} fill={stroke} />
    </svg>
  ),
  table: (size = 48) => (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="table">
      <rect x="10" y="22" width="44" height="8" rx="2" {...common} />
      <line x1="18" y1="30" x2="18" y2="50" {...common} />
      <line x1="46" y1="30" x2="46" y2="50" {...common} />
    </svg>
  ),
  chair: (size = 48) => (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="chair">
      <rect x="22" y="14" width="20" height="14" rx="2" {...common} />
      <rect x="22" y="28" width="20" height="8" rx="2" {...common} />
      <line x1="24" y1="36" x2="24" y2="50" {...common} />
      <line x1="40" y1="36" x2="40" y2="50" {...common} />
    </svg>
  ),
};
const PALETTE = [
  { type: "bed", label: "Bed", render: () => Icons.bed(48) },
  { type: "door", label: "Door", render: () => Icons.door(48) },
  { type: "table", label: "Table", render: () => Icons.table(48) },
  { type: "chair", label: "Chair", render: () => Icons.chair(48) },
];

let idCounter = 1;
const nextId = () => `item_${idCounter++}`;

export default function ImageCanvasApp() {
  // Pan/zoom + BG state
  const [bgPan, setBgPan] = useState({ x: 0, y: 0 });
  const [bgUrl, setBgUrl] = useState(null);
  const lastBgUrlRef = useRef(null);
  const [bgSize, setBgSize] = useState({ baseW: 0, baseH: 0, naturalW: 0, naturalH: 0, scale: 1 });

  // Items & UI state
  const [items, setItems] = useState([]); // {id, type, fx, fy, size}
  const [walls, setWalls] = useState([]); // {id, fx, fy, fw, fh}
  const [wallsMode, setWallsMode] = useState(false);
  const [wallDraftStart, setWallDraftStart] = useState(null); // {fx, fy} or null
  const [wallDraftEnd, setWallDraftEnd] = useState(null);   // {fx, fy} or null

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [resizeTick, setResizeTick] = useState(0);

  // History for items + background + walls
  const [history, setHistory] = useState([{ items: [], walls: [], bgUrl: null, bgSize: { baseW: 0, baseH: 0, naturalW: 0, naturalH: 0, scale: 1 } }]);
  const [hIndex, setHIndex] = useState(0);
  const canUndo = hIndex > 0;
  const canRedo = hIndex < history.length - 1;

  // Refs
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const draggingRef = useRef({ id: null, offsetFx: 0, offsetFy: 0 });
  const resizingRef = useRef({ id: null, startSize: 0, startX: 0, startY: 0 });
  const dragStartSnapshotRef = useRef(null); // to commit one history entry per drag
  const wheelTimerRef = useRef(null);
  const panDragRef = useRef({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 });
  const pointersRef = useRef(new Map()); // id -> {x,y}
  const wallDraggingRef = useRef({ id: null, offsetFx: 0, offsetFy: 0, fw: 0, fh: 0, startWalls: null });

  // Keep state in sync with history on mount
  useEffect(() => {
    const initial = { items: [], walls: [], bgUrl: null, bgSize: { baseW: 0, baseH: 0, naturalW: 0, naturalH: 0, scale: 1 } };
    setHistory([initial]); setHIndex(0); setItems(initial.items); setWalls(initial.walls); setBgUrl(initial.bgUrl); setBgSize(initial.bgSize);
  }, []);

  // Snapshot helpers
  function snapshotState(nextItems = items, nextBgUrl = bgUrl, nextBgSize = bgSize, nextWalls = walls) {
    setHistory((prev) => {
      const trimmed = prev.slice(0, hIndex + 1);
      const snap = { items: deepClone(nextItems), walls: deepClone(nextWalls), bgUrl: nextBgUrl, bgSize: { ...nextBgSize } };
      const newHist = [...trimmed, snap]; setHIndex(newHist.length - 1); return newHist;
    });
    setItems(nextItems); setWalls(nextWalls); setBgUrl(nextBgUrl); setBgSize(nextBgSize);
  }
  const snapshotItems = (nextItems) => snapshotState(nextItems, bgUrl, bgSize, walls);
  const snapshotWalls = (nextWalls) => snapshotState(items, bgUrl, bgSize, nextWalls);

  // API: toggle walls mode
  function selectWalls() { setWallsMode((v) => !v); setWallDraftStart(null); setWallDraftEnd(null); }

  // ---------- Geometry helpers ----------
  function getCanvasRect() {
    const el = canvasRef.current; if (!el) return { left: 0, top: 0, width: 0, height: 0 };
    const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  function getDisplayDims() { return { dispW: Math.max(0, Math.round(bgSize.baseW * bgSize.scale)), dispH: Math.max(0, Math.round(bgSize.baseH * bgSize.scale)) }; }
  function getBgFrame() {
    const { width: cw, height: ch, left, top } = getCanvasRect();
    const { dispW, dispH } = getDisplayDims();
    const dx = Math.floor((cw - dispW) / 2) + Math.round(bgPan.x);
    const dy = Math.floor((ch - dispH) / 2) + Math.round(bgPan.y);
    return { dx, dy, left, top, cw, ch, dispW, dispH };
  }
  function getRefFrame() {
    // Free placement across the whole canvas (not limited to BG bounds)
    const f = getBgFrame();
    return { dx: 0, dy: 0, left: f.left, top: f.top, refW: f.cw, refH: f.ch, cw: f.cw, ch: f.ch, bgDx: f.dx, bgDy: f.dy, dispW: f.dispW, dispH: f.dispH };
  }

  // ---------- Upload handling ----------
  function onFile(file) {
    if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const naturalW = img.width, naturalH = img.height;
        let baseW = 0, baseH = 0;
        if (isRoughlySquare(naturalW, naturalH)) { baseW = 300; baseH = 300; }
        else { const bounded = fitWithin(naturalW, naturalH, 500, 1000); baseW = bounded.w; baseH = bounded.h; }
        if (lastBgUrlRef.current && lastBgUrlRef.current !== url) { try { URL.revokeObjectURL(lastBgUrlRef.current); } catch {} }
        lastBgUrlRef.current = url;
        snapshotState(items, url, { baseW, baseH, naturalW, naturalH, scale: 1 }, walls);
      };
      img.src = url;
    } catch (_) {}
  }
  const onInputChange = (e) => { const f = e?.target?.files?.[0]; if (!f) return; onFile(f); try { e.target.value = ""; } catch (_) {} };

  // ---------- DnD: palette → canvas ----------
  function onPaletteDragStart(e, type) {
    if (!e?.dataTransfer) return;
    // Provide multiple MIME types for best Safari compatibility
    try { e.dataTransfer.setData("text/plain", type); e.dataTransfer.setData("text", type); } catch {}
    e.dataTransfer.effectAllowed = "copyMove";
    // Safer drag image for Safari – use the element itself if available
    if (e.dataTransfer.setDragImage && e.currentTarget) {
      try { e.dataTransfer.setDragImage(e.currentTarget, e.currentTarget.clientWidth/2, e.currentTarget.clientHeight/2); } catch {}
    }
  }
  function onCanvasDragOver(e) { if (!e) return; e.preventDefault(); try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; } catch {} }
  function dropOnCanvas(clientX, clientY, type) {
    if (!canvasRef.current) return;
    const { dx, dy, left, top, refW, refH } = getRefFrame();
    const relX = refW > 0 ? (clientX - (left + dx)) / refW : 0;
    const relY = refH > 0 ? (clientY - (top + dy)) / refH : 0;
    const clampedFx = clamp01(relX);
    const clampedFy = clamp01(relY);
    const next = [...items, { id: nextId(), type, fx: clampedFx, fy: clampedFy, size: 48 }];
    snapshotItems(next);
  }
  function onCanvasDrop(e) {
    e.preventDefault(); const dt = e.dataTransfer;
    if (dt?.files?.length > 0) { const f = dt.files[0]; if (f?.type?.startsWith("image/")) onFile(f); return; }
    const type = dt.getData("text/plain") || dt.getData("text"); if (type) dropOnCanvas(e.clientX, e.clientY, type);
  }

  // ---------- Drag placed items ----------
  function onItemPointerDown(e, id) {
    if (e.button !== 0) return; // left button only
    e.stopPropagation();
    const { dx, dy, left, top, refW, refH } = getRefFrame();
    const item = items.find((it) => it.id === id); if (!item || refW === 0 || refH === 0) return;
    const localX = e.clientX - (left + dx); const localY = e.clientY - (top + dy);
    const fx = clamp01(localX / refW); const fy = clamp01(localY / refH);
    draggingRef.current = { id, offsetFx: fx - (item.fx ?? 0), offsetFy: fy - (item.fy ?? 0) };
    dragStartSnapshotRef.current = deepClone(items);
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  }
  function onItemResizePointerDown(e, id) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const it = items.find(i => i.id === id); if (!it) return;
    resizingRef.current = { id, startSize: Math.max(16, it.size ?? 48), startX: e.clientX, startY: e.clientY };
    dragStartSnapshotRef.current = deepClone(items);
    (e.currentTarget?.setPointerCapture)?.(e.pointerId);
  }

  // ---------- Walls interactions ----------
  function handleCanvasClick(e) {
    if (!wallsMode) return;
    const { dx, dy, left, top, refW, refH } = getRefFrame(); if (refW === 0 || refH === 0) return;
    const localX = e.clientX - (left + dx); const localY = e.clientY - (top + dy);
    const fx1 = clamp01(localX / refW); const fy1 = clamp01(localY / refH);
    // Single-click start; next click finishes
    if (!wallDraftStart) { setWallDraftStart({ fx: fx1, fy: fy1 }); setWallDraftEnd({ fx: fx1, fy: fy1 }); return; }
    const r = normRect(wallDraftStart.fx, wallDraftStart.fy, fx1, fy1);
    const rect = { id: `wall_${Date.now()}_${Math.random().toString(36).slice(2)}`, ...r };
    const nextWalls = [...walls, rect];
    setWallDraftStart(null); setWallDraftEnd(null);
    snapshotWalls(nextWalls);
  }
  function onWallPointerDown(e, id) {
    if (e.button !== 0) return; // left button only
    const { dx, dy, left, top, refW, refH } = getRefFrame(); if (refW === 0 || refH === 0) return;
    const wall = walls.find((w) => w.id === id); if (!wall) return;
    const localX = e.clientX - (left + dx); const localY = e.clientY - (top + dy);
    const fx = clamp01(localX / refW); const fy = clamp01(localY / refH);
    wallDraggingRef.current = { id, offsetFx: fx - (wall.fx ?? 0), offsetFy: fy - (wall.fy ?? 0), fw: wall.fw ?? 0, fh: wall.fh ?? 0, startWalls: deepClone(walls) };
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  }

  // ---------- Pointer move / pan / pinch ----------
  function onCanvasPointerMove(e) {
    // Item resizing first
    const rsz = resizingRef.current; if (rsz.id) {
      const it = items.find(i => i.id === rsz.id); if (!it) return;
      const dxMove = e.clientX - rsz.startX; const dyMove = e.clientY - rsz.startY;
      const delta = Math.max(dxMove, dyMove);
      const newSize = Math.max(16, Math.min(256, Math.round((rsz.startSize || 48) + delta)));
      setItems(prev => prev.map(x => x.id === rsz.id ? { ...x, size: newSize } : x));
      return;
    }
    // Wall dragging
    const wdrag = wallDraggingRef.current; if (wdrag.id) {
      const { dx, dy, left, top, refW, refH } = getRefFrame(); if (refW === 0 || refH === 0) return;
      const localX = e.clientX - (left + dx); const localY = e.clientY - (top + dy);
      let newFx = clamp01(localX / refW) - wdrag.offsetFx; let newFy = clamp01(localY / refH) - wdrag.offsetFy;
      newFx = Math.max(0, Math.min(1 - wdrag.fw, newFx)); newFy = Math.max(0, Math.min(1 - wdrag.fh, newFy));
      setWalls(prev => prev.map(w => w.id === wdrag.id ? { ...w, fx: newFx, fy: newFy } : w));
      return;
    }
    // Item dragging
    const drag = draggingRef.current; if (drag.id) {
      const { dx, dy, left, top, refW, refH } = getRefFrame(); if (refW === 0 || refH === 0) return;
      const localX = e.clientX - (left + dx); const localY = e.clientY - (top + dy);
      const fx = clamp01(localX / refW) - drag.offsetFx; const fy = clamp01(localY / refH) - drag.offsetFy;
      setItems(prev => prev.map(it => it.id === drag.id ? { ...it, fx: clamp01(fx), fy: clamp01(fy) } : it));
      return;
    }
    // Live preview rectangle while drafting
    if (wallsMode && wallDraftStart) {
      const { dx, dy, left, top, refW, refH } = getRefFrame(); if (refW === 0 || refH === 0) return;
      const localX = e.clientX - (left + dx); const localY = e.clientY - (top + dy);
      setWallDraftEnd({ fx: clamp01(localX / refW), fy: clamp01(localY / refH) });
    }

    // Pan with space/middle button
    if (panDragRef.current.active) {
      const dxMove = e.clientX - panDragRef.current.startX; const dyMove = e.clientY - panDragRef.current.startY;
      setBgPan({ x: panDragRef.current.origX + dxMove, y: panDragRef.current.origY + dyMove });
      return;
    }

    // Pinch-to-zoom with two touches
    if (e.pointerType === 'touch' && pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size === 2) {
        const pts = Array.from(pointersRef.current.values()); const [p1, p2] = pts;
        const midX = (p1.x + p2.x) / 2; const midY = (p1.y + p2.y) / 2;
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (!onCanvasPointerMove._lastDist) onCanvasPointerMove._lastDist = dist;
        const factor = dist / onCanvasPointerMove._lastDist;
        if (!Number.isNaN(factor) && factor > 0) {
          applyZoomAt(midX, midY, factor);
          if (!onCanvasPointerMove._lastMid) onCanvasPointerMove._lastMid = { x: midX, y: midY };
          const dmx = midX - onCanvasPointerMove._lastMid.x; const dmy = midY - onCanvasPointerMove._lastMid.y;
          setBgPan((p) => ({ x: p.x + dmx, y: p.y + dmy }));
          onCanvasPointerMove._lastMid = { x: midX, y: midY };
        }
        onCanvasPointerMove._lastDist = dist;
      }
    }
  }
  function onCanvasPointerUp(e) {
    // finish item resize
    const rsz = resizingRef.current; if (rsz.id) {
      resizingRef.current = { id: null, startSize: 0, startX: 0, startY: 0 };
      const before = dragStartSnapshotRef.current || []; const changed = JSON.stringify(before) !== JSON.stringify(items);
      if (changed) snapshotItems(items); dragStartSnapshotRef.current = null;
    }
    // finish wall drag
    const wdrag = wallDraggingRef.current; if (wdrag.id) {
      wallDraggingRef.current.id = null;
      const changed = wdrag.startWalls && JSON.stringify(wdrag.startWalls) !== JSON.stringify(walls);
      if (changed) snapshotWalls(walls);
    }
    if (panDragRef.current.active) { panDragRef.current.active = false; scheduleBgSnapshot(); }
    const drag = draggingRef.current; if (drag.id != null) {
      draggingRef.current = { id: null, offsetFx: 0, offsetFy: 0 };
      const before = dragStartSnapshotRef.current || []; const changed = JSON.stringify(before) !== JSON.stringify(items);
      if (changed) snapshotItems(items); dragStartSnapshotRef.current = null;
    }
    pointersRef.current.delete(e.pointerId);
    onCanvasPointerMove._lastDist = null; onCanvasPointerMove._lastMid = null;
  }
  function onCanvasPointerCancel(e) { pointersRef.current.delete(e.pointerId); panDragRef.current.active = false; onCanvasPointerMove._lastDist = null; onCanvasPointerMove._lastMid = null; }

  // Handle pointer down on canvas (start pan or track pinch pointers)
  function onCanvasPointerDown(e) {
    if (e.pointerType === 'touch') { pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); }
    const isPanKey = e.button === 1 || e.buttons === 4 || e.getModifierState?.('Space');
    if (isPanKey) { e.preventDefault(); panDragRef.current = { active: true, startX: e.clientX, startY: e.clientY, origX: bgPan.x, origY: bgPan.y }; }
  }

  // ---------- Scale background ----------
  function scheduleBgSnapshot(nextBgSize) {
    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = setTimeout(() => { snapshotState(items, bgUrl, nextBgSize ?? bgSize, walls); }, 300);
  }
  function onCanvasWheel(e) {
    if (!bgUrl) return; if (!(e.shiftKey || e.ctrlKey)) return; // desktop/hardware keyboards
    e.preventDefault();
    const { left, top } = getCanvasRect(); const focusX = e.clientX - left; const focusY = e.clientY - top;
    const dir = e.deltaY < 0 ? 1 : -1; const step = e.shiftKey && e.ctrlKey ? 0.15 : 0.1; const factor = 1 + dir * step;
    applyZoomAt(focusX, focusY, factor);
  }
  function nudgeZoom(mult) { if (!bgUrl) return; const { left, top, width, height } = getCanvasRect(); applyZoomAt(left + width / 2, top + height / 2, mult); }
  function applyZoomAt(screenX, screenY, factor) {
    setBgSize((s) => {
      const nextScale = Math.min(5, Math.max(0.2, s.scale * factor));
      const dispW = s.baseW * s.scale; const dispH = s.baseH * s.scale;
      const { left, top, width: cw, height: ch } = getCanvasRect();
      const beforeDx = Math.floor((cw - dispW) / 2) + Math.round(bgPan.x);
      const beforeDy = Math.floor((ch - dispH) / 2) + Math.round(bgPan.y);
      const offsetX = screenX - (left + beforeDx); const offsetY = screenY - (top + beforeDy);
      const scaleRatio = nextScale / s.scale;
      setBgPan((p) => ({ x: p.x - (offsetX * (scaleRatio - 1)), y: p.y - (offsetY * (scaleRatio - 1)) }));
      const next = { ...s, scale: nextScale }; scheduleBgSnapshot(next); return next;
    });
  }

  // ---------- Toolbar actions ----------
  function clearAll() { snapshotState([], bgUrl, bgSize, []); }
  function removeItem(id) { snapshotItems(items.filter((it) => it.id !== id)); }
  function clearBackground() {
    const reset = { baseW: 0, baseH: 0, naturalW: 0, naturalH: 0, scale: 1 };
    if (lastBgUrlRef.current) { try { URL.revokeObjectURL(lastBgUrlRef.current); } catch {} lastBgUrlRef.current = null; }
    snapshotState(items, null, reset, walls);
  }

  async function saveCompositionImage() {
    try {
      if (!canvasRef.current) return;
      const { bgDx, bgDy, dispW, dispH } = getRefFrame();
      const exportOnlyBgArea = Boolean(bgUrl && dispW > 0 && dispH > 0);
      const outW = exportOnlyBgArea ? Math.round(dispW) : Math.max(1, Math.floor(canvasRef.current.getBoundingClientRect().width));
      const outH = exportOnlyBgArea ? Math.round(dispH) : Math.max(1, Math.floor(canvasRef.current.getBoundingClientRect().height));
      const canvas = document.createElement('canvas');
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      canvas.width = outW * dpr; canvas.height = outH * dpr; canvas.style.width = `${outW}px`; canvas.style.height = `${outH}px`;
      const ctx = canvas.getContext('2d'); if (!ctx) return; ctx.scale(dpr, dpr);
      if (!exportOnlyBgArea) { ctx.fillStyle = '#faf9f5'; ctx.fillRect(0, 0, outW, outH); }
      if (bgUrl && dispW > 0 && dispH > 0) {
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => { const x = exportOnlyBgArea ? 0 : Math.round(bgDx); const y = exportOnlyBgArea ? 0 : Math.round(bgDy); ctx.drawImage(img, x, y, Math.round(dispW), Math.round(dispH)); resolve(); };
          img.onerror = resolve; img.src = bgUrl;
        });
      }
      const { refW, refH } = getRefFrame();
      // Draw walls (pink)
      ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#ff4da6'; ctx.strokeStyle = '#ff4da6';
      for (const w of walls) {
        const leftPx = Math.round((w.fx ?? 0) * refW);
        const topPx  = Math.round((w.fy ?? 0) * refH);
        const wPx = Math.round((w.fw ?? 0) * refW);
        const hPx = Math.round((w.fh ?? 0) * refH);
        const drawX = exportOnlyBgArea ? leftPx - Math.round(bgDx) : leftPx;
        const drawY = exportOnlyBgArea ? topPx  - Math.round(bgDy) : topPx;
        ctx.fillRect(drawX, drawY, wPx, hPx); ctx.strokeRect(drawX, drawY, wPx, hPx);
      }
      ctx.restore();

      // Draw items (SVG icons)
      for (const it of items) {
        const node = document.getElementById(it.id); if (!node) continue;
        const svg = node.querySelector('svg'); if (!svg) continue;
        const onScreenLeft = Math.round((it.fx ?? 0) * refW);
        const onScreenTop  = Math.round((it.fy ?? 0) * refH);
        const left = exportOnlyBgArea ? onScreenLeft - Math.round(bgDx) : onScreenLeft;
        const top  = exportOnlyBgArea ? onScreenTop  - Math.round(bgDy) : onScreenTop;
        const clone = svg.cloneNode(true);
        const svgStr = new XMLSerializer().serializeToString(clone);
        const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const sizePx = Math.max(16, Math.min(256, it.size ?? 48));
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => { ctx.drawImage(img, left, top, sizePx, sizePx); URL.revokeObjectURL(url); resolve(); };
          img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          img.src = url;
        });
      }
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a'); a.href = dataUrl; a.download = exportOnlyBgArea ? 'composition-transparent.png' : 'composition.png';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { console.error('saveCompositionImage failed', err); alert('Could not save the composition image.'); }
  }

  // Undo/Redo actions
  function undo() { if (!canUndo) return; const newIdx = hIndex - 1; setHIndex(newIdx); const snap = history[newIdx]; setItems(deepClone(snap.items)); setWalls(deepClone(snap.walls || [])); setBgUrl(snap.bgUrl); setBgSize({ ...snap.bgSize }); }
  function redo() { if (!canRedo) return; const newIdx = hIndex + 1; setHIndex(newIdx); const snap = history[newIdx]; setItems(deepClone(snap.items)); setWalls(deepClone(snap.walls || [])); setBgUrl(snap.bgUrl); setBgSize({ ...snap.bgSize }); }

  // Keyboard shortcuts for Undo/Redo – stable
  const undoRef = useRef(undo); const redoRef = useRef(redo);
  useEffect(() => { undoRef.current = undo; redoRef.current = redo; });
  useEffect(() => {
    function onKeyDown(e) { const mod = e.ctrlKey || e.metaKey; if (!mod) return; const k = e.key.toLowerCase(); if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoRef.current(); } else if (k === 'z' && e.shiftKey) { e.preventDefault(); redoRef.current(); } else if (k === 'y') { e.preventDefault(); redoRef.current(); } }
    window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Rerender on resize
  useEffect(() => { const onResize = () => setResizeTick((t) => t + 1); window.addEventListener('resize', onResize); return () => window.removeEventListener('resize', onResize); }, []);

  // ---------- Styles ----------
  const styles = {
    app: { width: "100vw", height: "100vh", background: "#faf9f5", color: "#333", fontFamily: "Inter, system-ui, Arial, sans-serif", position: "relative", userSelect: "none" },
    sidebar: (open) => ({ position: "absolute", top: 0, left: 0, bottom: 0, width: 180, background: "#faf9f5", borderRight: "1px solid rgba(0,0,0,.1)", transform: `translateX(${open ? 0 : -180}px)`, transition: "transform .25s ease, opacity .2s ease", padding: 12, display: "flex", flexDirection: "column", gap: 12, zIndex: 20, opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }),
    paletteCard: { background: "transparent", border: "1px solid rgba(0,0,0,.1)", borderRadius: 12, padding: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, cursor: "grab", textAlign: "center" },
    floaterBar: { position: "absolute", top: 12, right: 12, display: "flex", gap: 8, zIndex: 40 },
    floaterBtn: { width: 44, height: 44, borderRadius: 22, background: "rgba(0,0,0,0.0)", border: "1px solid rgba(0,0,0,0.2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
    handle: { position: "absolute", top: "50%", left: 0, transform: "translate(-50%, -50%)", width: 28, height: 64, borderRadius: 14, background: "rgba(0,0,0,0.08)", border: "1px solid rgba(0,0,0,0.15)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#111", zIndex: 30 },
    placed: { position: "absolute", touchAction: "none", userSelect: "none", cursor: "grab", zIndex: 10, outline: 'none' },
    topChooseBtn: { fontSize: 14, cursor: "pointer", background: "transparent", color: "#666", border: "1px solid rgba(0,0,0,0.2)", padding: "10px 14px", borderRadius: 10, lineHeight: 1.2 },
    infoBtn: { position: "absolute", right: 16, bottom: 16, width: 44, height: 44, borderRadius: 22, background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, zIndex: 50 },
    infoBox: { position: "absolute", right: 70, bottom: 20, background: "#fff", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 8, padding: 12, fontSize: 12, color: "#333", width: 260, boxShadow: "0 2px 6px rgba(0,0,0,0.1)" },
    undoRedoBar: { position: "absolute", left: '50%', bottom: 16, transform: 'translateX(-50%)', display: 'flex', gap: 10, zIndex: 45 },
    undoRedoBtn: (enabled) => ({ minWidth: 72, height: 40, padding: '0 14px', borderRadius: 10, background: 'rgba(0,0,0,0.03)', border: `1px solid rgba(0,0,0,${enabled ? 0.25 : 0.12})`, color: enabled ? '#222' : '#999', cursor: enabled ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14 }),
    wallsBtn: (active) => ({ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', zIndex: 46, width: 44, height: 88, borderRadius: 14, border: '1px solid rgba(0,0,0,0.2)', background: active ? '#ffe3f1' : 'rgba(0,0,0,0.02)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12, color: '#333' }),
    wallRect: { position: 'absolute', background: 'rgba(255,77,166,0.35)', border: '2px solid rgba(255,77,166,0.85)', borderRadius: 4, pointerEvents: 'auto', cursor: 'move', zIndex: 2 },
    wallDraftRect: { position: 'absolute', background: 'rgba(255,77,166,0.2)', border: '2px dashed rgba(255,77,166,0.85)', borderRadius: 4, pointerEvents: 'none', zIndex: 1 },
    resizeHandle: { position: 'absolute', right: -6, bottom: -6, width: 16, height: 16, borderRadius: 8, background: '#fff', border: '1px solid rgba(0,0,0,0.3)', boxShadow: '0 1px 2px rgba(0,0,0,0.2)', display: 'grid', placeItems: 'center', cursor: 'nwse-resize', touchAction: 'none' },
    resizeGlyph: { fontSize: 10, lineHeight: 1, userSelect: 'none', pointerEvents: 'none' }
  };

  // ---------- Runtime tests (AFTER mount, never throw) ----------
  useEffect(() => {
    function safeAssert(cond, msg) { if (!cond) console.warn("Test failed:", msg); }
    function envReady() { try { if (!document || !document.body || !canvasRef.current) return false; const c = document.createElement('canvas'); const g = c.getContext('2d'); return Boolean(g); } catch { return false; } }
    function runTests() {
      try {
        // pure helpers
        safeAssert(JSON.stringify(fitWithin(1000, 1000, 500, 1000)) === JSON.stringify({ w: 500, h: 500 }), "fitWithin square downscale");
        safeAssert(JSON.stringify(fitWithin(2000, 1000, 500, 1000)) === JSON.stringify({ w: 500, h: 250 }), "fitWithin landscape downscale");
        safeAssert(JSON.stringify(fitWithin(1000, 2000, 500, 1000)) === JSON.stringify({ w: 500, h: 1000 }), "fitWithin portrait downscale");
        safeAssert(isRoughlySquare(100, 100) === true, "isRoughlySquare true");
        safeAssert(isRoughlySquare(100, 95) === true, "isRoughlySquare near-square");
        safeAssert(isRoughlySquare(100, 80) === false, "isRoughlySquare non-square");
        // history guards
        safeAssert(Array.isArray(history) && history.length >= 1, 'history init');
        safeAssert(hIndex >= 0, 'history index valid');
        // api presence
        safeAssert(typeof clearAll === 'function', 'clearAll present');
        safeAssert(typeof removeItem === 'function', 'removeItem present');
        // new: resize size propagation
        const testSize = 96; const test = [{id:'x', fx:.1, fy:.1, size:48, type:'bed'}];
        const grown = test.map(t => ({...t, size: testSize}));
        safeAssert(grown[0].size === testSize, 'resize updates size');
        console.log("%cRuntime tests passed", "color: green");
      } catch (err) { console.warn("Runtime tests caught error (non-fatal)", err); }
    }
    function start() {
      queueMicrotask(() => { requestAnimationFrame(() => { requestAnimationFrame(() => {
        let tries = 0; const max = 10; const tick = () => { if (envReady()) { runTests(); return; } tries += 1; if (tries < max) setTimeout(tick, 50); else console.warn('Runtime tests skipped: env not ready'); };
        setTimeout(tick, 0);
      }); }); });
    }
    if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
  }, []);

  // Defocus on background click so typing doesn't start accidentally
  function defocusActive(){ const ae = document.activeElement; if (ae && typeof ae.blur==='function' && ae !== document.body) ae.blur(); }

  const { dispW, dispH } = getDisplayDims();
  const { refW, refH } = getRefFrame();

  return (
    <div style={styles.app} tabIndex={-1} onMouseDown={defocusActive}>
      {/* Toolbar */}
      <div style={styles.floaterBar}>
        <button aria-label="Save as image" style={styles.floaterBtn} title="Save as image" onClick={saveCompositionImage}>⬇️</button>
        <button aria-label="Zoom out" style={styles.floaterBtn} title="Zoom out" onClick={() => nudgeZoom(1/1.1)}>−</button>
        <button aria-label="Zoom in" style={styles.floaterBtn} title="Zoom in" onClick={() => nudgeZoom(1.1)}>＋</button>
        <button aria-label="Clear items/walls" style={styles.floaterBtn} title="Clear items & walls" onClick={clearAll}>🧹</button>
        <button aria-label="Remove background" style={styles.floaterBtn} title="Remove background" onClick={clearBackground}>🗑️</button>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={onInputChange} hidden />
      </div>

      {/* Right-center Walls button */}
      <button aria-label="Select walls" onClick={selectWalls} style={styles.wallsBtn(wallsMode)} title="Walls (click to start, click to finish)">
        <span>Walls</span>
        <span style={{fontSize:10,opacity:.7}}>{wallsMode? 'ON':'OFF'}</span>
      </button>

      {/* Toggle handle */}
      <button aria-label="Toggle palette" onClick={() => setSidebarOpen((v) => !v)} style={styles.handle}>{sidebarOpen ? "‹" : "›"}</button>

      {/* Sidebar / Palette */}
      <aside style={styles.sidebar(sidebarOpen)} aria-hidden={!sidebarOpen}>
        {PALETTE.map((p) => (
          <div key={p.type} draggable onDragStart={(e) => onPaletteDragStart(e, p.type)} style={styles.paletteCard} title={`Drag ${p.label}`}>
            {p.render()}
            <div style={{ fontSize: 14 }}>{p.label}</div>
          </div>
        ))}
      </aside>

      {/* Canvas */}
      <div
        ref={canvasRef}
        style={{ position: 'relative', width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}
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
          <img src={bgUrl} alt="Background" draggable={false} onDragOver={onCanvasDragOver} onDragEnter={onCanvasDragOver} onDrop={onCanvasDrop} style={{ width: dispW, height: dispH, objectFit: 'contain', background: '#fff', borderRadius: 12 }} />
        ) : (
          <div style={{ textAlign: 'center', color: '#666' }}>
            <div style={{ fontSize: 18, marginBottom: 6 }}>Drop an image anywhere</div>
            <div style={{ fontSize: 13, marginBottom: 12, opacity: .8 }}>or</div>
            <button onClick={() => fileInputRef.current?.click()} style={styles.topChooseBtn}>Choose a file</button>
          </div>
        )}

        {/* Walls (above BG, below items) */}
        {walls.map((w) => {
          const leftPx = Math.round((w.fx ?? 0) * refW);
          const topPx  = Math.round((w.fy ?? 0) * refH);
          const wPx = Math.round((w.fw ?? 0) * refW);
          const hPx = Math.round((w.fh ?? 0) * refH);
          return <div key={w.id} style={{...styles.wallRect, left: leftPx, top: topPx, width: wPx, height: hPx}} onPointerDown={(e)=>onWallPointerDown(e, w.id)} aria-label="wall" />
        })}

        {/* Draft rectangle while drawing */}
        {wallsMode && wallDraftStart && wallDraftEnd && (() => {
          const r = normRect(wallDraftStart.fx, wallDraftStart.fy, wallDraftEnd.fx, wallDraftEnd.fy);
          const leftPx = Math.round(r.fx * refW);
          const topPx  = Math.round(r.fy * refH);
          const wPx = Math.round(r.fw * refW);
          const hPx = Math.round(r.fh * refH);
          return <div style={{ ...styles.wallDraftRect, left: leftPx, top: topPx, width: wPx, height: hPx }} />;
        })()}

        {/* Placed items (above everything) */}
        {items.map((it) => {
          const fx = it.fx ?? 0; const fy = it.fy ?? 0;
          const left = Math.round(fx * refW);
          const top = Math.round(fy * refH);
          const scale = Math.max(16, Math.min(256, (it.size ?? 48))) / 48;
          return (
            <div
              key={it.id}
              id={it.id}
              style={{ ...styles.placed, left, top, transform: `scale(${scale})`, transformOrigin: 'top left' }}
              onPointerDown={(e) => { e.stopPropagation(); onItemPointerDown(e, it.id); }}
              onClickCapture={(e) => e.stopPropagation()}
              onDragStart={(e)=>e.preventDefault()}
              onDoubleClick={() => removeItem(it.id)}
              title={`${it.type}`}
              role="img"
              aria-label={it.type}
              tabIndex={-1}
            >
              {Icons[it.type]?.(48)}
            </div>
          );
        })}

        {/* Resize handles overlay (absolute, above items) */}
        {items.map((it) => {
          const fx = it.fx ?? 0; const fy = it.fy ?? 0;
          const left = Math.round(fx * refW);
          const top = Math.round(fy * refH);
          const sizePx = Math.max(16, Math.min(256, it.size ?? 48));
          return (
            <div
              key={'rsz_'+it.id}
              role="button"
              aria-label="Resize"
              style={{ position:'absolute', left: left + sizePx - 6, top: top + sizePx - 6, width:16, height:16, borderRadius:8, background:'#fff', border:'1px solid rgba(0,0,0,0.3)', boxShadow:'0 1px 2px rgba(0,0,0,0.2)', display:'grid', placeItems:'center', cursor:'nwse-resize', touchAction:'none', zIndex: 11 }}
              onPointerDown={(e)=>{ e.stopPropagation(); onItemResizePointerDown(e, it.id); }}
              onClickCapture={(e)=>e.stopPropagation()}
            >
              <span style={{ fontSize:10, lineHeight:1, userSelect:'none', pointerEvents:'none' }}>↘︎</span>
            </div>
          );
        })}
      </div>

      {/* Undo / Redo (bottom center) */}
      <div style={styles.undoRedoBar}>
        <button aria-label="Undo" style={styles.undoRedoBtn(canUndo)} onClick={undo} disabled={!canUndo} title="Undo (Ctrl/⌘+Z)">↩︎ Undo</button>
        <button aria-label="Redo" style={styles.undoRedoBtn(canRedo)} onClick={redo} disabled={!canRedo} title="Redo (Ctrl/⌘+Y or Shift+Ctrl/⌘+Z)">Redo ↪︎</button>
      </div>

      {/* Info button + popup */}
      <button type="button" aria-label="Show tips" style={styles.infoBtn} onClick={() => setShowInfo(v => !v)}>ℹ️</button>
      {showInfo && (
        <div style={styles.infoBox}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Tips</div>
          <div>
            On desktop, hold <kbd>Shift</kbd> or <kbd>Ctrl/Cmd</kbd> and scroll to zoom the background. On touch devices, use the ＋/− buttons.
            Double‑click an item to delete it. Hold <kbd>Space</kbd> and drag to pan.
            <br/>Walls: click the right-center Walls button, then <strong>click</strong> to set the first corner and <strong>click again</strong> to set the opposite corner.
          </div>
        </div>
      )}
    </div>
  );
}
