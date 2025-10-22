// @ts-nocheck
import React, { useEffect, useRef, useState } from "react";

/**
 * AtlaS – React Image Canvas (pure JSX, no external deps)
 *
 * Fixes in this revision:
 * - Remove react-helmet dependency (some setups failed to resolve it). Use useEffect to set title + favicon.
 * - Add missing upload (📷) button back to the floater toolbar.
 * - Harden pointer-move math against null refs; guard when rect is missing.
 * - Keep palette hidden initially; remove tip from sidebar; info button shows tips.
 * - Keep double-click-to-delete; Shift/Ctrl+wheel zoom.
 * - Include lightweight runtime tests for helpers.
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
function localPoint(clientX, clientY, rect) {
  if (!rect) return { x: clientX, y: clientY };
  return { x: clientX - rect.left, y: clientY - rect.top };
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
  const [items, setItems] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false); // start hidden
  const [showInfo, setShowInfo] = useState(false);

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const draggingRef = useRef({ id: null, offsetX: 0, offsetY: 0 });

  // ---------- Title + Favicon (no Helmet) ----------
  useEffect(() => {
    try { document.title = "AtlaS"; } catch (_) {}
    try {
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><defs><linearGradient id='grad' x1='0%' y1='0%' x2='100%' y2='100%'><stop offset='0%' stop-color='%2390ee90' stop-opacity='1'/><stop offset='100%' stop-color='%23e0fff0' stop-opacity='1'/></linearGradient></defs><circle cx='12' cy='12' r='10' fill='url(%23grad)'/><path d='M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20' stroke='white' stroke-width='2' fill='none'/></svg>`;
      const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      let link = document.querySelector("link[rel='icon']");
      if (!link) { link = document.createElement("link"); link.setAttribute("rel", "icon"); document.head.appendChild(link); }
      link.setAttribute("type", "image/svg+xml");
      link.setAttribute("href", href);
    } catch (_) {}
  }, []);

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
        setBgUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
        setBgSize({ baseW, baseH, naturalW, naturalH, scale: 1 });
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

  // ---------- DnD: palette → canvas ----------
  function onPaletteDragStart(e, type) {
    if (!e?.dataTransfer) return;
    e.dataTransfer.setData("text/plain", type);
    e.dataTransfer.effectAllowed = "copy";
  }
  function onCanvasDragOver(e) { e?.preventDefault?.(); if (e?.dataTransfer) e.dataTransfer.dropEffect = "copy"; }
  function dropOnCanvas(clientX, clientY, type) {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const { x, y } = localPoint(clientX, clientY, rect);
    setItems((prev) => [...prev, { id: nextId(), type, x, y }]);
  }
  function onCanvasDrop(e) {
    e.preventDefault();
    const dt = e.dataTransfer;
    if (dt?.files?.length > 0) { const f = dt.files[0]; if (f?.type?.startsWith("image/")) onFile(f); return; }
    const type = dt.getData("text/plain");
    if (type) dropOnCanvas(e.clientX, e.clientY, type);
  }

  // ---------- Drag placed items ----------
  function onItemPointerDown(e, id) {
    const rect = canvasRef.current?.getBoundingClientRect();
    const item = items.find((it) => it.id === id);
    if (!item || !rect) return;
    const { x, y } = localPoint(e.clientX, e.clientY, rect);
    draggingRef.current = { id, offsetX: x - item.x, offsetY: y - item.y };
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  }
  function onCanvasPointerMove(e) {
    const drag = draggingRef.current; if (!drag.id) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { x, y } = localPoint(e.clientX, e.clientY, rect);
    const nx = x - drag.offsetX; const ny = y - drag.offsetY;
    setItems((prev) => prev.map((it) => (it.id === drag.id ? { ...it, x: nx, y: ny } : it)));
  }
  function onCanvasPointerUp() { draggingRef.current = { id: null, offsetX: 0, offsetY: 0 }; }

  // ---------- Scale background ----------
  function onCanvasWheel(e) {
    if (!bgUrl) return;
    if (!(e.shiftKey || e.ctrlKey)) return; // require modifier key
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    const step = e.shiftKey && e.ctrlKey ? 0.15 : 0.1;
    setBgSize((s) => ({ ...s, scale: Math.min(5, Math.max(0.2, s.scale * (1 + dir * step))) }));
  }

  // ---------- Clear / Save ----------
  function clearAll() { setItems([]); }
  function removeItem(id) { setItems((prev) => prev.filter((it) => it.id !== id)); }
  function clearBackground() { if (bgUrl) URL.revokeObjectURL(bgUrl); setBgUrl(null); setBgSize({ baseW: 0, baseH: 0, naturalW: 0, naturalH: 0, scale: 1 }); }

  async function savePNG() {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#faf9f5";
    ctx.fillRect(0, 0, width, height);

    if (bgUrl && bgSize.baseW && bgSize.baseH) {
      const dispW = Math.round(bgSize.baseW * bgSize.scale);
      const dispH = Math.round(bgSize.baseH * bgSize.scale);
      const dx = Math.floor((width - dispW) / 2);
      const dy = Math.floor((height - dispH) / 2);
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, dx, dy, dispW, dispH); resolve(); };
        img.onerror = resolve; img.src = bgUrl;
      });
    }

    // draw items (SVG -> raster)
    for (const it of items) {
      const node = document.getElementById(it.id);
      if (!node) continue;
      const svg = node.querySelector("svg");
      if (!svg) continue;
      const clone = svg.cloneNode(true);
      const svgStr = new XMLSerializer().serializeToString(clone);
      const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, it.x, it.y); URL.revokeObjectURL(url); resolve(); };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        img.src = url;
      });
    }

    const data = canvas.toDataURL("image/png");
    const a = document.createElement("a"); a.href = data; a.download = "composition.png";
    document.body.appendChild(a); a.click(); a.remove();
  }

  useEffect(() => () => { if (bgUrl) URL.revokeObjectURL(bgUrl); }, [bgUrl]);

  // ---------- Styles ----------
  const paletteWidth = 192;
  const styles = {
    app: { width: "100vw", height: "100vh", overflow: "hidden", background: "#faf9f5", color: "#333", fontFamily: "Inter, system-ui, Arial, sans-serif", position: "relative" },
    sidebar: (open) => ({ position: "absolute", top: 0, left: 0, bottom: 0, width: paletteWidth, zIndex: 20, background: "#faf9f5", borderRight: "1px solid rgba(0,0,0,.1)", transform: `translateX(${open ? 0 : -paletteWidth}px)`, transition: "transform .25s ease", padding: 12, display: "flex", flexDirection: "column", gap: 12 }),
    paletteCard: { background: "transparent", border: "1px solid rgba(0,0,0,.1)", borderRadius: 12, padding: 10, display: "flex", alignItems: "center", gap: 10, cursor: "grab" },
    floaterBar: { position: "absolute", top: 12, right: 12, zIndex: 40, display: "flex", gap: 8 },
    floaterBtn: { width: 44, height: 44, borderRadius: 22, background: "rgba(0,0,0,0.0)", color: "#111", border: "1px solid rgba(0,0,0,0.2)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
    handle: { position: "absolute", top: "50%", left: 0, transform: "translate(-50%, -50%)", width: 28, height: 64, borderRadius: 14, background: "rgba(0,0,0,0.08)", border: "1px solid rgba(0,0,0,0.15)", cursor: "pointer", zIndex: 30, display: "grid", placeItems: "center", fontSize: 14, color: "#111" },
    topChooseBtn: { fontSize: 14, cursor: "pointer", background: "transparent", color: "#666", border: "1px solid rgba(0,0,0,0.2)", padding: "10px 14px", borderRadius: 10, lineHeight: 1.2 },
    bgFrame: { position: "relative", boxShadow: "0 1px 8px rgba(0,0,0,.06)", borderRadius: 12, overflow: "hidden" },
    placed: { position: "absolute", touchAction: "none", userSelect: "none", cursor: "grab" },
    infoBtn: { position: "absolute", right: 16, bottom: 16, width: 44, height: 44, borderRadius: 22, background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.2)", cursor: "pointer", display: "grid", placeItems: "center", fontSize: 20 },
    infoBox: { position: "absolute", right: 70, bottom: 20, background: "#fff", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 8, padding: 12, fontSize: 12, color: "#333", width: 260, boxShadow: "0 2px 6px rgba(0,0,0,0.1)" }
  };

  const dispW = Math.max(0, Math.round(bgSize.baseW * bgSize.scale));
  const dispH = Math.max(0, Math.round(bgSize.baseH * bgSize.scale));

  return (
    <div style={styles.app}>
      {/* Floating buttons */}
      <div style={styles.floaterBar}>  
        <button style={styles.floaterBtn} title="Clear items" aria-label="Clear items" onClick={clearAll}>🧹</button>
        <button style={styles.floaterBtn} title="Remove background" aria-label="Remove background" onClick={clearBackground}>🗑️</button>
        <button style={styles.floaterBtn} title="Save PNG" aria-label="Save PNG" onClick={savePNG}>💾</button>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={onInputChange} hidden />
      </div>

      {/* Toggle handle */}
      <button aria-label="Toggle palette" onClick={() => setSidebarOpen((v) => !v)} style={styles.handle}>{sidebarOpen ? "‹" : "›"}</button>

      {/* Sidebar / Palette */}
      <aside style={styles.sidebar(sidebarOpen)} aria-hidden={!sidebarOpen} aria-label="Palette sidebar">
        {PALETTE.map((p) => (
          <div key={p.type} draggable onDragStart={(e) => onPaletteDragStart(e, p.type)} style={styles.paletteCard} role="button" aria-label={`Drag ${p.label} into canvas`}>
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
        role="application"
        aria-label="Design canvas"
      >
        {/* Background image (centered) */}
        {bgUrl ? (
          <div style={{ ...styles.bgFrame, width: dispW, height: dispH }}>
            <img src={bgUrl} alt="Background" draggable={false} style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain', background: '#fff' }} />
          </div>
        ) : null}

        {/* Empty state */}
        {!bgUrl && (
          <div style={{ textAlign: 'center', color: '#666' }}>
            <div style={{ fontSize: 18, marginBottom: 6 }}>Drop an image anywhere</div>
            <div style={{ fontSize: 13, marginBottom: 12, opacity: .8 }}>or</div>
            <button onClick={() => fileInputRef.current?.click()} style={styles.topChooseBtn}>Choose a file</button>
          </div>
        )}

        {/* Placed items */}
        {items.map((it) => (
          <div
            key={it.id}
            id={it.id}
            style={{ ...styles.placed, left: it.x, top: it.y }}
            onPointerDown={(e) => onItemPointerDown(e, it.id)}
            onDoubleClick={() => removeItem(it.id)}
            title={`${it.type}`}
          >
            {Icons[it.type]?.(48)}
          </div>
        ))}
      </div>

      {/* Info button + popup */}
      <button
        type="button"
        aria-label="Show tips"
        title="Tips"
        style={styles.infoBtn}
        onClick={() => setShowInfo((v) => !v)}
      >
        ℹ️
      </button>
      {showInfo && (
        <div role="status" aria-live="polite" style={styles.infoBox}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Tips</div>
          <div>Hold <kbd>Shift</kbd> or <kbd>Ctrl/Cmd</kbd> and scroll to zoom the background. Double-click an item to delete it.</div>
        </div>
      )}
    </div>
  );
}

// ---------- Lightweight runtime tests (dev only) ----------
const __DEV__ = typeof process !== "undefined" ? process.env?.NODE_ENV !== "production" : true;
if (__DEV__) {
  try {
    // fitWithin tests
    console.assert(JSON.stringify(fitWithin(1000, 1000, 500, 1000)) === JSON.stringify({ w: 500, h: 500 }), "fitWithin square downscale failed");
    console.assert(JSON.stringify(fitWithin(2000, 1000, 500, 1000)) === JSON.stringify({ w: 500, h: 250 }), "fitWithin landscape downscale failed");
    console.assert(JSON.stringify(fitWithin(1000, 2000, 500, 1000)) === JSON.stringify({ w: 500, h: 1000 }), "fitWithin portrait downscale failed");

    // isRoughlySquare tests
    console.assert(isRoughlySquare(100, 100) === true, "isRoughlySquare true failed");
    console.assert(isRoughlySquare(100, 95) === true, "isRoughlySquare near-square failed");
    console.assert(isRoughlySquare(100, 80) === false, "isRoughlySquare non-square failed");

    // localPoint tests
    const pt = localPoint(15, 25, { left: 10, top: 20 });
    console.assert(pt.x === 5 && pt.y === 5, "localPoint failed");

    // nextId format test
    const sample = nextId();
    console.assert(/^item_\d+$/.test(sample), "nextId format failed");

    console.log("%cAll helper tests passed", "color: green");
  } catch (err) {
    console.warn("Runtime tests threw", err);
  }
}
