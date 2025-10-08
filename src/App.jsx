import React, { useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet";

/** PURE JSX VERSION (no TS, no external libs)
 * Site branding updated:
 *  - Title set to "AtlaS"
 *  - Favicon set to a globe icon (SVG data URI)
 */

// ---------- Helpers (pure) ----------
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
  return { x: clientX - rect.left, y: clientY - rect.top };
}

// ---------- Icons ----------
const stroke = "#333";
const common = { fill: "none", stroke, strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" };

const Icons = {
  bed: (size = 48) => (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <rect x="6" y="30" width="52" height="18" rx="3" {...common} />
      <rect x="10" y="24" width="22" height="10" rx="2" {...common} />
      <line x1="6" y1="48" x2="6" y2="54" {...common} />
      <line x1="58" y1="48" x2="58" y2="54" {...common} />
    </svg>
  ),
  door: (size = 48) => (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <rect x="18" y="6" width="28" height="52" rx="2" {...common} />
      <circle cx="40" cy="32" r="2.5" stroke={stroke} fill={stroke} />
    </svg>
  ),
  table: (size = 48) => (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <rect x="10" y="22" width="44" height="8" rx="2" {...common} />
      <line x1="18" y1="30" x2="18" y2="50" {...common} />
      <line x1="46" y1="30" x2="46" y2="50" {...common} />
    </svg>
  ),
  chair: (size = 48) => (
    <svg width={size} height={size} viewBox="0 0 64 64">
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
  // ---------- State & refs ----------
  const [bgUrl, setBgUrl] = useState(null);
  const [bgSize, setBgSize] = useState({ baseW: 0, baseH: 0, naturalW: 0, naturalH: 0, scale: 1 });
  const [items, setItems] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const draggingRef = useRef({ id: null, offsetX: 0, offsetY: 0 });

  // ---------- Upload handling ----------
  function onFile(file) {
    if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const naturalW = img.width, naturalH = img.height;
        let baseW = 0, baseH = 0;
        if (isRoughlySquare(naturalW, naturalH)) {
          baseW = 300; baseH = 300;
        } else {
          const bounded = fitWithin(naturalW, naturalH, 500, 1000);
          baseW = bounded.w; baseH = bounded.h;
        }
        setBgUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
        setBgSize({ baseW, baseH, naturalW, naturalH, scale: 1 });
      };
      img.src = url;
    } catch (_) { }
  }
  function onInputChange(e) {
    const f = e && e.target && e.target.files && e.target.files[0];
    if (!f) return;
    onFile(f);
    try { e.target.value = ""; } catch (_) {}
  }

  // ---------- DnD: palette → canvas ----------
  function onPaletteDragStart(e, type) {
    if (!e || !e.dataTransfer) return;
    e.dataTransfer.setData("text/plain", type);
    e.dataTransfer.effectAllowed = "copy";
  }
  function onCanvasDragOver(e) {
    if (!e) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }
  function dropOnCanvas(clientX, clientY, type) {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const { x, y } = localPoint(clientX, clientY, rect);
    setItems((prev) => [...prev, { id: nextId(), type, x, y }]);
  }
  function onCanvasDrop(e) {
    if (!e) return;
    e.preventDefault();
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
      const f = dt.files[0];
      if (f && f.type && f.type.startsWith("image/")) onFile(f);
      return;
    }
    if (!dt) return;
    const type = dt.getData("text/plain");
    if (!type) return;
    dropOnCanvas(e.clientX, e.clientY, type);
  }

  // ---------- Drag placed items ----------
  function onItemPointerDown(e, id) {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const item = items.find((it) => it.id === id);
    if (!item) return;
    const { x, y } = localPoint(e.clientX, e.clientY, rect);
    draggingRef.current = { id, offsetX: x - item.x, offsetY: y - item.y };
    if (e.currentTarget && e.pointerId != null) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    }
  }
  function onCanvasPointerMove(e) {
    const drag = draggingRef.current; if (!drag.id || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const { x, y } = localPoint(e.clientX, e.clientY, rect);
    const nx = x - drag.offsetX; const ny = y - drag.offsetY;
    setItems((prev) => prev.map((it) => (it.id === drag.id ? { ...it, x: nx, y: ny } : it)));
  }
  function onCanvasPointerUp() { draggingRef.current = { id: null, offsetX: 0, offsetY: 0 }; }

  // ---------- Scale background ----------
  function onCanvasWheel(e) {
    if (!bgUrl) return;
    if (!(e.shiftKey || e.ctrlKey)) return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    const step = e.shiftKey && e.ctrlKey ? 0.15 : 0.1;
    setBgSize((s) => {
      const ns = Math.min(5, Math.max(0.2, s.scale * (1 + dir * step)));
      return { ...s, scale: ns };
    });
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

    ctx.fillStyle = "#f0f5f1";
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
    const a = document.createElement("a");
    a.href = data; a.download = "composition.png";
    document.body.appendChild(a); a.click(); a.remove();
  }

  useEffect(() => () => { if (bgUrl) URL.revokeObjectURL(bgUrl); }, [bgUrl]);

  // ---------- Styles ----------
  const paletteWidth = 172;
  const styles = {
    app: { width: "100vw", height: "100vh", overflow: "hidden", background: "#f0f5f1", color: "#333", fontFamily: "Inter, system-ui, Arial, sans-serif" },
    sidebar: (open) => ({ position: "absolute", top: 0, left: 0, bottom: 0, width: paletteWidth, zIndex: 20, background: "#f0f5f1", borderRight: "1px solid rgba(0,0,0,.1)", transform: `translateX(${open ? 0 : -paletteWidth}px)`, transition: "transform .25s ease" }),
    paletteCard: { background: "transparent", border: "1px solid rgba(0,0,0,.1)", borderRadius: 12, padding: 10, display: "flex", alignItems: "center", gap: 10, cursor: "grab" },
    canvas: { position: "relative", width: "100%", height: "100%", backgroundColor: "#f0f5f1", display: "grid", placeItems: "center" },
    emptyState: { position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#666" },
    floaterBar: { position: "absolute", top: 12, right: 12, zIndex: 40, display: "flex", gap: 8 },
    floaterBtn: { width: 44, height: 44, borderRadius: 22, background: "rgba(0,0,0,0.0)", color: "#111", border: "1px solid rgba(0,0,0,0.2)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0, lineHeight: 0, WebkitTapHighlightColor: "transparent" },
    handle: { position: "absolute", top: "50%", left: 0, transform: "translate(-50%, -50%)", width: 28, height: 64, borderRadius: 14, background: "rgba(0,0,0,0.08)", border: "1px solid rgba(0,0,0,0.15)", cursor: "pointer", zIndex: 30, display: "grid", placeItems: "center", fontSize: 14, color: "#111" },
    topChooseBtn: { fontSize: 12, textDecoration: "underline", cursor: "pointer", background: "none", border: "none", padding: 0 },
  };

  const dispW = Math.max(0, Math.round(bgSize.baseW * bgSize.scale));
  const dispH = Math.max(0, Math.round(bgSize.baseH * bgSize.scale));

  return (
    <div style={styles.app}>
      <Helmet>
        <title>AtlaS</title>
        <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><defs><linearGradient id='grad' x1='0%' y1='0%' x2='100%' y2='100%'><stop offset='0%' stop-color='%2390ee90' stop-opacity='1'/><stop offset='100%' stop-color='%23e0fff0' stop-opacity='1'/></linearGradient></defs><circle cx='12' cy='12' r='10' fill='url(%23grad)'/><path d='M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20' stroke='white' stroke-width='2' fill='none'/></svg>" />
      </Helmet>

      {/* Floating buttons */}
      <div style={styles.floaterBar}>
        {/* ... buttons unchanged ... */}
      </div>

      {/* Toggle handle */}
      <button aria-label="Toggle palette" onClick={() => setSidebarOpen((v) => !v)} style={styles.handle}>{sidebarOpen ? "‹" : "›"}</button>

      {/* Palette, Canvas, etc. unchanged below */}
    </div>
  );
}
