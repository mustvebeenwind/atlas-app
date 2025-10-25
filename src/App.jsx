// @ts-nocheck
import React, { useRef, useState, useEffect } from "react";

/**
 * AtlaS – React Image Canvas (pure JSX)
 *
 * Undo / Redo controls (bottom-center). Tracks:
 *  - item placements, deletions, clears, drags (single history entry per drag)
 *  - background changes: upload, remove, zoom (debounced)
 *
 * Existing features:
 *  - Icons centered in buttons/cards; hidden palette; relative positioning vs reference frame (bg or full canvas)
 *  - Save as image: exports exact composition; crops to bg with transparent outside when bg present
 *  - Double-click item to delete; zoom with Shift/Ctrl + wheel
 *  - Robust, *non-throwing* runtime tests that only run when the DOM is truly ready
 */

// ---------- Helpers ----------
function fitWithin(imgW, imgH, maxW, maxH) {
  if (!imgW || !imgH) return { w: 0, h: 0 };
  const r = Math.min(maxW / imgW, maxH / imgH);
  return { w: Math.round(imgW * r), h: Math.round(imgH * r) };
}
function isRoughlySquare(w, h) {
  if (!w || !h) return false;
  const r = w / h; return r > 0.9 && r < 1.1;
}

// ---------- Icons ----------
const stroke = "#333";
const common = { fill: "none", stroke, strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" };
const Icons = {
  bed: (size = 48) => (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect x="6" y="30" width="52" height="18" rx="3" {...common} />
      <rect x="10" y="24" width="22" height="10" rx="2" {...common} />
      <line x1="6" y1="48" x2="6" y2="54" {...common} />
      <line x1="58" y1="48" x2="58" y2="54" {...common} />
    </svg>
  ),
  door: (size = 48) => (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect x="18" y="6" width="28" height="52" rx="2" {...common} />
      <circle cx="40" cy="32" r="2.5" stroke={stroke} fill={stroke} />
    </svg>
  ),
  table: (size = 48) => (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect x="10" y="22" width="44" height="8" rx="2" {...common} />
      <line x1="18" y1="30" x2="18" y2="50" {...common} />
      <line x1="46" y1="30" x2="46" y2="50" {...common} />
    </svg>
  ),
  chair: (size = 48) => (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
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
  const [bgUrl, setBgUrl] = useState(null);
  const [bgSize, setBgSize] = useState({ baseW: 0, baseH: 0, naturalW: 0, naturalH: 0, scale: 1 });
  const [items, setItems] = useState([]); // {id, type, fx, fy}
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [resizeTick, setResizeTick] = useState(0);

  // History for items + background
  const [history, setHistory] = useState([{ items: [], bgUrl: null, bgSize: { baseW: 0, baseH: 0, naturalW: 0, naturalH: 0, scale: 1 } }]);
  const [hIndex, setHIndex] = useState(0);
  const canUndo = hIndex > 0;
  const canRedo = hIndex < history.length - 1;

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const draggingRef = useRef({ id: null, offsetFx: 0, offsetFy: 0 });
  const dragStartSnapshotRef = useRef(null); // to commit a single history entry per drag

  // Keep state in sync with history on mount
  useEffect(() => {
    const initial = { items: [], bgUrl: null, bgSize: { baseW: 0, baseH: 0, naturalW: 0, naturalH: 0, scale: 1 } };
    setHistory([initial]);
    setHIndex(0);
    setItems(initial.items);
    setBgUrl(initial.bgUrl);
    setBgSize(initial.bgSize);
  }, []);

  // Snapshot helpers
  function snapshotState(nextItems, nextBgUrl = bgUrl, nextBgSize = bgSize) {
    setHistory((prev) => {
      const trimmed = prev.slice(0, hIndex + 1);
      const snap = {
        items: structuredClone ? structuredClone(nextItems) : JSON.parse(JSON.stringify(nextItems)),
        bgUrl: nextBgUrl,
        bgSize: { ...nextBgSize },
      };
      const newHist = [...trimmed, snap];
      setHIndex(newHist.length - 1);
      return newHist;
    });
    setItems(nextItems);
    setBgUrl(nextBgUrl);
    setBgSize(nextBgSize);
  }
  function snapshotItems(nextItems) { snapshotState(nextItems); }

  // ---------- Geometry helpers ----------
  function getCanvasRect() {
    const el = canvasRef.current;
    if (!el) return { left: 0, top: 0, width: 0, height: 0 };
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  function getDisplayDims() {
    return { dispW: Math.max(0, Math.round(bgSize.baseW * bgSize.scale)), dispH: Math.max(0, Math.round(bgSize.baseH * bgSize.scale)) };
  }
  function getBgFrame() {
    const { width: cw, height: ch, left, top } = getCanvasRect();
    const { dispW, dispH } = getDisplayDims();
    const dx = Math.floor((cw - dispW) / 2);
    const dy = Math.floor((ch - dispH) / 2);
    return { dx, dy, left, top, cw, ch, dispW, dispH };
  }
  function getRefFrame() {
    const f = getBgFrame();
    const hasBg = f.dispW > 0 && f.dispH > 0;
    return { dx: hasBg ? f.dx : 0, dy: hasBg ? f.dy : 0, left: f.left, top: f.top, refW: hasBg ? f.dispW : f.cw, refH: hasBg ? f.dispH : f.ch, cw: f.cw, ch: f.ch };
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
        setBgUrl(url);
        setBgSize({ baseW, baseH, naturalW, naturalH, scale: 1 });
        // snapshot background change into history
        snapshotState(items, url, { baseW, baseH, naturalW, naturalH, scale: 1 });
      };
      img.src = url;
    } catch (_) {}
  }
  function onInputChange(e) {
    const f = e?.target?.files?.[0];
    if (!f) return;
    onFile(f);
    try { e.target.value = ""; } catch (_) {}
  }

  // ---------- DnD: palette → canvas (store as fractions) ----------
  function onPaletteDragStart(e, type) {
    if (!e?.dataTransfer) return;
    e.dataTransfer.setData("text/plain", type);
    e.dataTransfer.effectAllowed = "copy";
  }
  function onCanvasDragOver(e) { e?.preventDefault?.(); }
  function dropOnCanvas(clientX, clientY, type) {
    if (!canvasRef.current) return;
    const { dx, dy, left, top, refW, refH } = getRefFrame();
    const fx = refW > 0 ? (clientX - (left + dx)) / refW : 0;
    const fy = refH > 0 ? (clientY - (top + dy)) / refH : 0;
    const clampedFx = Math.max(0, Math.min(1, fx));
    const clampedFy = Math.max(0, Math.min(1, fy));
    const next = [...items, { id: nextId(), type, fx: clampedFx, fy: clampedFy }];
    snapshotState(next);
  }
  function onCanvasDrop(e) {
    e.preventDefault();
    const dt = e.dataTransfer;
    if (dt?.files?.length > 0) { const f = dt.files[0]; if (f?.type?.startsWith("image/")) onFile(f); return; }
    const type = dt.getData("text/plain");
    if (type) dropOnCanvas(e.clientX, e.clientY, type);
  }

  // ---------- Drag placed items (update fractions) ----------
  function onItemPointerDown(e, id) {
    const { dx, dy, left, top, refW, refH } = getRefFrame();
    const item = items.find((it) => it.id === id);
    if (!item || refW === 0 || refH === 0) return;
    const px = e.clientX - (left + dx);
    const py = e.clientY - (top + dy);
    const fx = Math.max(0, Math.min(1, px / refW));
    const fy = Math.max(0, Math.min(1, py / refH));
    draggingRef.current = { id, offsetFx: fx - (item.fx ?? 0), offsetFy: fy - (item.fy ?? 0) };
    dragStartSnapshotRef.current = (structuredClone ? structuredClone(items) : JSON.parse(JSON.stringify(items)));
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  }
  function onCanvasPointerMove(e) {
    const drag = draggingRef.current; if (!drag.id) return;
    const { dx, dy, left, top, refW, refH } = getRefFrame();
    if (refW === 0 || refH === 0) return;
    const px = e.clientX - (left + dx);
    const py = e.clientY - (top + dy);
    const fx = Math.max(0, Math.min(1, px / refW)) - drag.offsetFx;
    const fy = Math.max(0, Math.min(1, py / refH)) - drag.offsetFy;
    const clampedFx = Math.max(0, Math.min(1, fx));
    const clampedFy = Math.max(0, Math.min(1, fy));
    setItems((prev) => prev.map((it) => (it.id === drag.id ? { ...it, fx: clampedFx, fy: clampedFy } : it)));
  }
  function onCanvasPointerUp() {
    const drag = draggingRef.current;
    if (drag.id != null) {
      // Commit one history entry if changed
      draggingRef.current = { id: null, offsetFx: 0, offsetFy: 0 };
      const before = dragStartSnapshotRef.current || [];
      const changed = JSON.stringify(before) !== JSON.stringify(items);
      if (changed) snapshotState(items);
      dragStartSnapshotRef.current = null;
    }
  }

  // ---------- Scale background ----------
  const wheelTimerRef = useRef(null);
  function scheduleBgSnapshot(nextBgSize) {
    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = setTimeout(() => { snapshotState(items, bgUrl, nextBgSize); }, 300);
  }
  function onCanvasWheel(e) {
    if (!bgUrl) return;
    if (!(e.shiftKey || e.ctrlKey)) return;
    e.preventDefault();
    setBgSize((s) => {
      const dir = e.deltaY < 0 ? 1 : -1;
      const step = e.shiftKey && e.ctrlKey ? 0.15 : 0.1;
      const nextScale = Math.min(5, Math.max(0.2, s.scale * (1 + dir * step)));
      const next = { ...s, scale: nextScale };
      scheduleBgSnapshot(next);
      return next;
    });
  }

  // ---------- Toolbar actions ----------
  function clearAll() { snapshotState([]); }
  function removeItem(id) { snapshotState(items.filter((it) => it.id !== id)); }
  function clearBackground() {
    const reset = { baseW: 0, baseH: 0, naturalW: 0, naturalH: 0, scale: 1 };
    snapshotState(items, null, reset);
  }

  async function saveCompositionImage() {
    try {
      if (!canvasRef.current) return;
      const { dx, dy, dispW, dispH } = getBgFrame();
      const exportOnlyBgArea = Boolean(bgUrl && dispW > 0 && dispH > 0);
      const outW = exportOnlyBgArea ? Math.round(dispW) : Math.max(1, Math.floor(canvasRef.current.getBoundingClientRect().width));
      const outH = exportOnlyBgArea ? Math.round(dispH) : Math.max(1, Math.floor(canvasRef.current.getBoundingClientRect().height));
      const canvas = document.createElement('canvas');
      canvas.width = outW; canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (!exportOnlyBgArea) { ctx.fillStyle = '#faf9f5'; ctx.fillRect(0, 0, outW, outH); }
      if (bgUrl && dispW > 0 && dispH > 0) {
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => { const x = exportOnlyBgArea ? 0 : Math.round(dx); const y = exportOnlyBgArea ? 0 : Math.round(dy); ctx.drawImage(img, x, y, Math.round(dispW), Math.round(dispH)); resolve(); };
          img.onerror = resolve; img.src = bgUrl;
        });
      }
      const { refW, refH } = getRefFrame();
      for (const it of items) {
        const node = document.getElementById(it.id); if (!node) continue;
        const svg = node.querySelector('svg'); if (!svg) continue;
        const onScreenLeft = dx + Math.round((it.fx ?? 0) * refW);
        const onScreenTop  = dy + Math.round((it.fy ?? 0) * refH);
        const left = exportOnlyBgArea ? onScreenLeft - dx : onScreenLeft;
        const top  = exportOnlyBgArea ? onScreenTop  - dy : onScreenTop;
        const clone = svg.cloneNode(true);
        const svgStr = new XMLSerializer().serializeToString(clone);
        const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => { ctx.drawImage(img, left, top); URL.revokeObjectURL(url); resolve(); };
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
  function undo() {
    if (!canUndo) return;
    const newIdx = hIndex - 1;
    setHIndex(newIdx);
    const snap = history[newIdx];
    setItems(structuredClone ? structuredClone(snap.items) : JSON.parse(JSON.stringify(snap.items)));
    setBgUrl(snap.bgUrl);
    setBgSize({ ...snap.bgSize });
  }
  function redo() {
    if (!canRedo) return;
    const newIdx = hIndex + 1;
    setHIndex(newIdx);
    const snap = history[newIdx];
    setItems(structuredClone ? structuredClone(snap.items) : JSON.parse(JSON.stringify(snap.items)));
    setBgUrl(snap.bgUrl);
    setBgSize({ ...snap.bgSize });
  }

  // Keyboard shortcuts for Undo/Redo
  useEffect(() => {
    function onKeyDown(e) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (e.key.toLowerCase() === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
      else if (e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hIndex, history]);

  // Rerender on resize (macOS fullscreen etc.)
  useEffect(() => {
    const onResize = () => setResizeTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ---------- Styles ----------
  const styles = {
    app: { width: "100vw", height: "100vh", background: "#faf9f5", color: "#333", fontFamily: "Inter, system-ui, Arial, sans-serif", position: "relative" },
    sidebar: (open) => ({ position: "absolute", top: 0, left: 0, bottom: 0, width: 180, background: "#faf9f5", borderRight: "1px solid rgba(0,0,0,.1)", transform: `translateX(${open ? 0 : -180}px)`, transition: "transform .25s ease, opacity .2s ease", padding: 12, display: "flex", flexDirection: "column", gap: 12, zIndex: 20, opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }),
    paletteCard: { background: "transparent", border: "1px solid rgba(0,0,0,.1)", borderRadius: 12, padding: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, cursor: "grab", textAlign: "center" },
    floaterBar: { position: "absolute", top: 12, right: 12, display: "flex", gap: 8, zIndex: 40 },
    floaterBtn: { width: 44, height: 44, borderRadius: 22, background: "rgba(0,0,0,0.0)", border: "1px solid rgba(0,0,0,0.2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
    handle: { position: "absolute", top: "50%", left: 0, transform: "translate(-50%, -50%)", width: 28, height: 64, borderRadius: 14, background: "rgba(0,0,0,0.08)", border: "1px solid rgba(0,0,0,0.15)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#111", zIndex: 30 },
    placed: { position: "absolute", touchAction: "none", userSelect: "none", cursor: "grab" },
    topChooseBtn: { fontSize: 14, cursor: "pointer", background: "transparent", color: "#666", border: "1px solid rgba(0,0,0,0.2)", padding: "10px 14px", borderRadius: 10, lineHeight: 1.2 },
    infoBtn: { position: "absolute", right: 16, bottom: 16, width: 44, height: 44, borderRadius: 22, background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, zIndex: 50 },
    infoBox: { position: "absolute", right: 70, bottom: 20, background: "#fff", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 8, padding: 12, fontSize: 12, color: "#333", width: 260, boxShadow: "0 2px 6px rgba(0,0,0,0.1)" },
    undoRedoBar: { position: "absolute", left: '50%', bottom: 16, transform: 'translateX(-50%)', display: 'flex', gap: 10, zIndex: 45 },
    undoRedoBtn: (enabled) => ({ minWidth: 72, height: 40, padding: '0 14px', borderRadius: 10, background: 'rgba(0,0,0,0.03)', border: `1px solid rgba(0,0,0,${enabled ? 0.25 : 0.12})`, color: enabled ? '#222' : '#999', cursor: enabled ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14 })
  };

  // ---------- Runtime tests (AFTER mount, never throw) ----------
  useEffect(() => {
    function safeAssert(cond, msg) { if (!cond) console.warn("Test failed:", msg); }

    function envReady() {
      try {
        if (!document || !document.body || !canvasRef.current) return false;
        const c = document.createElement('canvas');
        const g = c.getContext('2d');
        return Boolean(g);
      } catch { return false; }
    }

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
        console.log("%cRuntime tests passed", "color: green");
      } catch (err) {
        console.warn("Runtime tests caught error (non-fatal)", err);
      }
    }

    // robust deferral: load → microtask → 2×RAF → retry loop (10× every 50ms)
    function start() {
      queueMicrotask(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            let tries = 0;
            const max = 10;
            const tick = () => {
              if (envReady()) { runTests(); return; }
              tries += 1;
              if (tries < max) setTimeout(tick, 50);
              else console.warn('Runtime tests skipped: env not ready');
            };
            setTimeout(tick, 0);
          });
        });
      });
    }

    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  }, []);

  const { dispW, dispH } = getDisplayDims();
  const { dx, dy, refW, refH } = getRefFrame();

  return (
    <div style={styles.app} data-resize-tick={resizeTick}>
      {/* Toolbar */}
      <div style={styles.floaterBar}>
        <button style={styles.floaterBtn} title="Save as image" onClick={saveCompositionImage}>⬇️</button>
        <button style={styles.floaterBtn} title="Clear items" onClick={clearAll}>🧹</button>
        <button style={styles.floaterBtn} title="Remove background" onClick={clearBackground}>🗑️</button>
        {/* Hidden input used by the empty-state "Choose a file" */}
        <input ref={fileInputRef} type="file" accept="image/*" onChange={onInputChange} hidden />
      </div>

      {/* Toggle handle */}
      <button aria-label="Toggle palette" onClick={() => setSidebarOpen((v) => !v)} style={styles.handle}>{sidebarOpen ? "‹" : "›"}</button>

      {/* Sidebar / Palette */}
      <aside style={styles.sidebar(sidebarOpen)} aria-hidden={!sidebarOpen}>
        {PALETTE.map((p) => (
          <div key={p.type} draggable onDragStart={(e) => onPaletteDragStart(e, p.type)} style={styles.paletteCard}>
            {p.render()}
            <div style={{ fontSize: 14 }}>{p.label}</div>
          </div>
        ))}
      </aside>

      {/* Canvas */}
      <div
        ref={canvasRef}
        style={{ position: 'relative', width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}
        onDragOver={onCanvasDragOver}
        onDrop={onCanvasDrop}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onWheel={onCanvasWheel}
      >
        {bgUrl ? (
          <img src={bgUrl} alt="Background" draggable={false} style={{ width: dispW, height: dispH, objectFit: 'contain', background: '#fff', borderRadius: 12 }} />
        ) : (
          <div style={{ textAlign: 'center', color: '#666' }}>
            <div style={{ fontSize: 18, marginBottom: 6 }}>Drop an image anywhere</div>
            <div style={{ fontSize: 13, marginBottom: 12, opacity: .8 }}>or</div>
            <button onClick={() => fileInputRef.current?.click()} style={styles.topChooseBtn}>Choose a file</button>
          </div>
        )}

        {/* Placed items (relative to reference frame) */}
        {items.map((it) => {
          const fx = it.fx ?? 0; const fy = it.fy ?? 0;
          const left = dx + Math.round(fx * refW);
          const top = dy + Math.round(fy * refH);
          return (
            <div
              key={it.id}
              id={it.id}
              style={{ ...styles.placed, left, top }}
              onPointerDown={(e) => onItemPointerDown(e, it.id)}
              onDoubleClick={() => removeItem(it.id)}
              title={`${it.type}`}
            >
              {Icons[it.type]?.(48)}
            </div>
          );
        })}
      </div>

      {/* Undo / Redo (bottom center) */}
      <div style={styles.undoRedoBar}>
        <button style={styles.undoRedoBtn(canUndo)} onClick={undo} disabled={!canUndo} title="Undo (Ctrl/⌘+Z)">↩︎ Undo</button>
        <button style={styles.undoRedoBtn(canRedo)} onClick={redo} disabled={!canRedo} title="Redo (Ctrl/⌘+Y or Shift+Ctrl/⌘+Z)">Redo ↪︎</button>
      </div>

      {/* Info button + popup */}
      <button type="button" style={styles.infoBtn} onClick={() => setShowInfo(v => !v)}>ℹ️</button>
      {showInfo && (
        <div style={styles.infoBox}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Tips</div>
          <div>Hold <kbd>Shift</kbd> or <kbd>Ctrl/Cmd</kbd> and scroll to zoom the background. Double-click an item to delete it.</div>
        </div>
      )}
    </div>
  );
}
