import React, { useRef, useState, useEffect, useMemo } from "react";

/* ===== Yeat-ish bell (safe) ===== */
function playYeatBell(ctx, { gain = 0.9, pitch = 880 } = {}) {
  const t = ctx.currentTime;
  const master = ctx.createGain(); master.gain.value = gain; master.connect(ctx.destination);
  const carrier = ctx.createOscillator(); carrier.type = "sine"; carrier.frequency.setValueAtTime(pitch, t);
  const mod = ctx.createOscillator(); mod.type = "sine"; mod.frequency.setValueAtTime(pitch / 4, t);
  const modDepth = ctx.createGain(); modDepth.gain.setValueAtTime(520, t); mod.connect(modDepth).connect(carrier.frequency);
  const partial = ctx.createOscillator(); partial.type = "triangle"; partial.frequency.setValueAtTime(pitch * 1.5, t);
  const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(1.0, t + 0.007); env.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
  carrier.connect(env); partial.connect(env); env.connect(master);
  carrier.start(t); mod.start(t); partial.start(t);
  carrier.stop(t + 1.0); mod.stop(t + 1.0); partial.stop(t + 1.0);
}
function ensureAudioContext(ref) {
  if (!ref.current) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ref.current = new AC();
  }
  if (ref.current.state === "suspended") ref.current.resume().catch(()=>{});
  return ref.current;
}

/* ===== tiny utils ===== */
const isPlainObject = (x) => !!x && typeof x === "object" && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const merge = (o, p) => ({ ...(isPlainObject(o) ? o : {}), ...(isPlainObject(p) ? p : {}) });
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const round = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
const fitWithin = (w, h, maxW, maxH) => {
  const r = Math.min(maxW / Math.max(1, w), maxH / Math.max(1, h));
  return { w: Math.round(w * r), h: Math.round(h * r) };
};
const getCanvasRect = (el) => { if (!el) return { left:0, top:0, width:0, height:0 }; const r = el.getBoundingClientRect(); return { left:r.left, top:r.top, width:r.width, height:r.height }; };

/* ===== visuals ===== */
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
const PALETTE = ["bed", "door", "table", "chair"].map(t => ({ type:t, label:t[0].toUpperCase()+t.slice(1) }));
let idCounter = 1; const nextId = () => `item_${idCounter++}`;

const styles = {
  app: { width:"100vw", height:"100vh", background:"#faf9f5", color:"#333", fontFamily:"Inter, system-ui, Arial, sans-serif", position:"relative", userSelect:"none", overflow:"hidden" },
  floaterBar:{ position:"absolute", top:12, right:12, display:"flex", gap:8, zIndex:40 },
  floaterBtn:{ width:44, height:44, borderRadius:22, background:"rgba(0,0,0,0)", border:"1px solid rgba(0,0,0,0.2)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" },
  sidebar:(open)=>({ position:"absolute", top:0, left:0, bottom:0, width:180, background:"#faf9f5", borderRight:"1px solid rgba(0,0,0,.1)", transform:`translateX(${open?0:-180}px)`, transition:"transform .25s, opacity .2s", padding:12, display:"flex", flexDirection:"column", gap:12, zIndex:50, opacity:open?1:0, pointerEvents:open?"auto":"none" }),
  paletteCard:{ background:"transparent", border:"1px solid rgba(0,0,0,.1)", borderRadius:12, padding:10, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6, cursor:"grab", textAlign:"center" },
  toggleHandle:{ position:"absolute", top:"50%", left:0, transform:"translate(-50%, -50%)", width:28, height:64, borderRadius:14, background:"rgba(0,0,0,0.08)", border:"1px solid rgba(0,0,0,0.15)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color:"#111", zIndex:60 },
  stack:{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", zIndex:46, width:160, display:"flex", flexDirection:"column", gap:8 },
  selectBtn:(open)=>({ width:"100%", minHeight:44, borderRadius:14, border:"1px solid rgba(0,0,0,0.2)", background:open?"#fff":"rgba(0,0,0,0.02)", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"stretch", justifyContent:"center", fontSize:12, color:"#333" }),
  header:(open)=>({ padding:8, textAlign:"center", fontWeight:700, borderBottom:open?"1px solid rgba(0,0,0,0.1)":"none" }),
  menu:{ display:"flex", flexDirection:"column", gap:6, padding:8 },
  item:(active, color)=>({ padding:"8px 10px", borderRadius:10, border:`1px solid ${active?color:"rgba(0,0,0,0.15)"}`, background:active?`${color}22`:"transparent", cursor:"pointer", textAlign:"center", fontWeight:600 }),
  stopBtn:{ width:"100%", minHeight:40, borderRadius:12, border:"1px solid rgba(0,0,0,0.2)", background:"#fff", cursor:"pointer", fontSize:12, fontWeight:700 },
  topChooseBtn:{ fontSize:14, cursor:"pointer", background:"transparent", color:"#666", border:"1px solid rgba(0,0,0,0.2)", padding:"10px 14px", borderRadius:10, lineHeight:1.2 },
  undoRedoBar:{ position:"absolute", left:"50%", bottom:16, transform:"translateX(-50%)", display:"flex", gap:10, zIndex:45 },
  undoRedoBtn:(ena)=>({ minWidth:72, height:40, padding:"0 14px", borderRadius:10, background:"rgba(0,0,0,0.03)", border:`1px solid rgba(0,0,0,${ena?0.25:0.12})`, color:ena?"#222":"#999", cursor:ena?"pointer":"not-allowed", display:"flex", alignItems:"center", justifyContent:"center", gap:8, fontSize:14 }),
  world:{ position:"absolute", transformOrigin:"top left", background:"#faf9f5" },
  bgImg:{ position:"absolute", left:0, top:0, objectFit:"contain", borderRadius:0 },
  rect:(b,s)=>({ position:"absolute", background:b, border:`2px solid ${s}`, borderRadius:0, cursor:"move" }),
  draft:(b,s)=>({ position:"absolute", background:b, border:`2px dashed ${s}`, borderRadius:0, pointerEvents:"none" }),
  windowTag:{ position:"absolute", transform:"translateY(-110%)", background:"#fff", border:"1px solid rgba(0,0,0,0.15)", borderRadius:8, padding:"3px 6px", fontSize:11, lineHeight:1.2, color:"#064", boxShadow:"0 1px 2px rgba(0,0,0,0.06)", pointerEvents:"auto", cursor:"pointer", zIndex:12, whiteSpace:"nowrap" },
  placed:{ position:"absolute", touchAction:"none", userSelect:"none", cursor:"grab", zIndex:10, outline:"none" },
  resizeHandle:(color)=>({ position:"absolute", width:8, height:8, background:"#fff", border:`2px solid ${color}`, borderRadius:2, boxShadow:"0 1px 2px rgba(0,0,0,0.15)", zIndex:12, touchAction:"none" }),
  note:{ position:"absolute", left:"50%", bottom:64, transform:"translateX(-50%)", background:"#fff", border:"1px solid rgba(0,0,0,0.15)", borderRadius:10, padding:"8px 12px", fontSize:13, color:"#0a0a0a", boxShadow:"0 2px 6px rgba(0,0,0,0.08)", zIndex:48 },
};

const colorFor = (k) => (k === "wall" ? "#ff4da6" : k === "window" ? "#00a050" : "#0a28a0");

export default function ImageCanvasApp() {
  /* ===== audio ===== */
  const audioCtxRef = useRef(null); const bellPlayedRef = useRef(false);
  useEffect(() => {
    const unlock = () => {
      if (bellPlayedRef.current) return;
      try { const ctx = ensureAudioContext(audioCtxRef); playYeatBell(ctx); bellPlayedRef.current = true; } catch {}
    };
    window.addEventListener("pointerdown", unlock, { passive:true });
    window.addEventListener("keydown", unlock, { passive:true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  /* ===== palette ===== */
  const [sidebarOpen, setSidebarOpen] = useState(false);

  /* ===== world & pan ===== */
  const canvasRef = useRef(null);
  const [world, setWorld] = useState({ w: 0, h: 0, scale: 1 });
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // ensure world has size on first paint (prevents blank)
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const r = getCanvasRect(el);
    if (r.width && r.height && (world.w === 0 || world.h === 0)) {
      setWorld({ w: Math.floor(r.width * 0.8), h: Math.floor(r.height * 0.8), scale: 1 });
      setPan({ x: 0, y: 0 });
    }
  }, [canvasRef, world.w, world.h]);

  // keep centered on resize
  useEffect(() => {
    if (!canvasRef.current) return;
    let prev = getCanvasRect(canvasRef.current);
    const ro = new ResizeObserver(() => {
      const rect = getCanvasRect(canvasRef.current);
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

  /* ===== bg image ===== */
  const [bgUrl, setBgUrl] = useState(null);
  const lastBgUrlRef = useRef(null);
  const [bgImg, setBgImg] = useState({ w: 0, h: 0 });
  const bgOffset = useMemo(() => ({
    x: (world.w - bgImg.w) / 2,
    y: (world.h - bgImg.h) / 2
  }), [world.w, world.h, bgImg.w, bgImg.h]);

  /* ===== layers/items ===== */
  const [walls, setWalls] = useState([]);
  const [windows, setWindows] = useState([]);
  const [floors, setFloors] = useState([]);
  const [items, setItems] = useState([]);

  /* ===== selection/drawing ===== */
  const [activeTool, setActiveTool] = useState(null);
  const [selectOpen, setSelectOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [draft, setDraft] = useState(null);

  /* ===== window prompt ===== */
  const [windowPrompt, setWindowPrompt] = useState(null);

  /* ===== history ===== */
  const [history, setHistory] = useState([{ items:[], walls:[], windows:[], floors:[], bgUrl:null, world:{w:0,h:0,scale:1}, pan:{x:0,y:0}, bgImg:{w:0,h:0} }]);
  const [hIndex, setHIndex] = useState(0);
  const canUndo = hIndex > 0, canRedo = hIndex < history.length - 1;

  /* ===== helpers ===== */
  const snapshot = (next = {}) => {
    const snap = { items, walls, windows, floors, bgUrl, world: { ...world }, pan: { ...pan }, bgImg: { ...bgImg }, ...next };
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
    if (next.world) setWorld(next.world);
    if (next.pan) setPan(next.pan);
    if (next.bgImg) setBgImg(next.bgImg);
  };

  const getRefFrame = () => {
    const { left, top, width:cw, height:ch } = getCanvasRect(canvasRef.current);
    const dispW = world.w * world.scale;
    const dispH = world.h * world.scale;
    const worldLeft = Math.floor((cw - dispW) / 2) + round(pan.x);
    const worldTop  = Math.floor((ch - dispH) / 2) + round(pan.y);
    return { left, top, cw, ch, worldLeft, worldTop, dispW, dispH };
  };

  const frame = useMemo(getRefFrame, [canvasRef.current, world.w, world.h, world.scale, pan.x, pan.y]);

  const screenToWorld = (clientX, clientY) => {
    const x = (clientX - (frame.left + frame.worldLeft)) / Math.max(0.0001, world.scale);
    const y = (clientY - (frame.top  + frame.worldTop )) / Math.max(0.0001, world.scale);
    return { x, y };
  };

  /* ===== upload bg ===== */
  const fileInputRef = useRef(null);
  const onFile = (file) => {
    if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const fit = fitWithin(img.width, img.height, Math.max(100, Math.floor(world.w*0.7)), Math.max(100, Math.floor(world.h*0.7)));
        if (lastBgUrlRef.current && lastBgUrlRef.current !== url) { try { URL.revokeObjectURL(lastBgUrlRef.current); } catch {} }
        lastBgUrlRef.current = url;
        snapshot({ bgUrl: url, bgImg: { w: fit.w, h: fit.h } });
      };
      img.src = url;
    } catch {}
  };
  const onInputChange = (e) => { const f = e?.target?.files?.[0]; if (f) onFile(f); try { e.target.value = ""; } catch {} };

  /* ===== palette DnD ===== */
  const onPaletteDragStart = (e, type) => {
    if (!e?.dataTransfer) return;
    try { e.dataTransfer.setData("text/plain", type); e.dataTransfer.setData("text", type); } catch {}
    e.dataTransfer.effectAllowed = "copyMove";
    if (e.dataTransfer.setDragImage && e.currentTarget) {
      try { e.dataTransfer.setDragImage(e.currentTarget, e.currentTarget.clientWidth/2, e.currentTarget.clientHeight/2); } catch {}
    }
  };
  const onCanvasDragOver = (e) => { e.preventDefault(); try { if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } catch {} };
  const onCanvasDrop = (e) => {
    e.preventDefault();
    const dt = e.dataTransfer;
    if (dt?.files?.length > 0) { const f = dt.files[0]; if (f?.type?.startsWith("image/")) onFile(f); return; }
    const type = dt.getData("text/plain") || dt.getData("text");
    if (!type) return;
    const pt = screenToWorld(e.clientX, e.clientY);
    snapshot({ items: [...items, { id: nextId(), type, x: pt.x, y: pt.y, size: 48 }] });
  };

  /* ===== tools ===== */
  const chooseTool = (k) => { setActiveTool(k); setSelectOpen(false); setSelecting(true); setDraft(null); };
  const stopSelecting = () => { setSelecting(false); setDraft(null); };
  const handleCanvasClick = (e) => {
    if (!activeTool || !selecting) return;
    const pt = screenToWorld(e.clientX, e.clientY);
    if (!draft) { setDraft({ start: { x: pt.x, y: pt.y }, end: { x: pt.x, y: pt.y } }); return; }
    const L = Math.min(draft.start.x, pt.x), T = Math.min(draft.start.y, pt.y);
    const R = Math.max(draft.start.x, pt.x), B = Math.max(draft.start.y, pt.y);
    const rect = { id:`${activeTool}_${Date.now()}_${Math.random().toString(36).slice(2)}`, x:L, y:T, w:R-L, h:B-T };
    if (activeTool === "wall")   snapshot({ walls:   [...walls, rect] });
    if (activeTool === "window") { snapshot({ windows: [...windows, rect] }); setWindowPrompt({ id:rect.id, value:"", error:"" }); }
    if (activeTool === "floor")  snapshot({ floors:  [...floors, rect] });
    setDraft(null);
  };

  /* ===== drag/resize ===== */
  const draggingItemRef = useRef({ id:null, dx:0, dy:0 });
  const itemResizeRef   = useRef({ id:null, start:0, sx:0, sy:0 });
  const draggingRectRef = useRef({ kind:null, id:null, dx:0, dy:0, start:null });
  const rectResizeRef   = useRef({ kind:null, id:null, handle:null, start:null, startList:null });
  const panDragRef      = useRef({ active:false, sx:0, sy:0, ox:0, oy:0 });

  const onWorldPointerDown = (e) => {
    const panKey = e.button === 1 || e.buttons === 4 || e.getModifierState?.("Space");
    if (panKey) {
      e.preventDefault();
      panDragRef.current = { active:true, sx:e.clientX, sy:e.clientY, ox:pan.x, oy:pan.y };
      return;
    }
  };
  const onRectPointerDown = (e, kind, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const pt = screenToWorld(e.clientX, e.clientY);
    const list = kind==="wall" ? walls : kind==="window" ? windows : floors;
    const r = list.find(x => x.id === id); if (!r) return;
    draggingRectRef.current = { kind, id, dx: pt.x - r.x, dy: pt.y - r.y, start: list };
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  };
  const onRectHandlePointerDown = (e, kind, id, handle) => {
    if (!selecting) return;
    e.stopPropagation();
    const list = kind==="wall" ? walls : kind==="window" ? windows : floors;
    const r = list.find(x => x.id === id); if (!r) return;
    rectResizeRef.current = { kind, id, handle, start: { ...r }, startList: list.map(x=>({ ...x })) };
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  };
  const onItemPointerDown = (e, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const pt = screenToWorld(e.clientX, e.clientY);
    const it = items.find(x=>x.id===id); if (!it) return;
    draggingItemRef.current = { id, dx: pt.x - it.x, dy: pt.y - it.y };
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  };
  const onItemResizePointerDown = (e, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const it = items.find((x) => x.id === id); if (!it) return;
    itemResizeRef.current = { id, start: Math.max(16, it.size || 48), sx: e.clientX, sy: e.clientY };
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  };

  const MIN_SIDE = 4;
  const onCanvasPointerMove = (e) => {
    if (panDragRef.current.active) {
      setPan({ x: panDragRef.current.ox + (e.clientX - panDragRef.current.sx), y: panDragRef.current.oy + (e.clientY - panDragRef.current.sy) });
      return;
    }
    const rr = rectResizeRef.current;
    if (rr.id) {
      const pt = screenToWorld(e.clientX, e.clientY);
      const s = rr.start;
      let L = s.x, T = s.y, R = s.x + s.w, B = s.y + s.h;
      const apply = {
        nw: ()=>{ L = pt.x; T = pt.y; }, ne: ()=>{ R = pt.x; T = pt.y; },
        sw: ()=>{ L = pt.x; B = pt.y; }, se: ()=>{ R = pt.x; B = pt.y; },
        n:  ()=>{ T = pt.y; }, s:  ()=>{ B = pt.y; }, w:  ()=>{ L = pt.x; }, e:  ()=>{ R = pt.x; },
      }[rr.handle];
      if (apply) apply();
      let nx = Math.min(L, R), ny = Math.min(T, B);
      let nw = Math.max(MIN_SIDE, Math.abs(R - L));
      let nh = Math.max(MIN_SIDE, Math.abs(B - T));
      const upd = { x:nx, y:ny, w:nw, h:nh };
      if (rr.kind === "wall")   setWalls   (prev => prev.map(r => r.id===rr.id ? merge(r, upd) : r));
      if (rr.kind === "window") setWindows (prev => prev.map(r => r.id===rr.id ? merge(r, upd) : r));
      if (rr.kind === "floor")  setFloors  (prev => prev.map(r => r.id===rr.id ? merge(r, upd) : r));
      return;
    }
    const dr = draggingRectRef.current;
    if (dr.id) {
      const pt = screenToWorld(e.clientX, e.clientY);
      const nx = pt.x - dr.dx, ny = pt.y - dr.dy;
      if (dr.kind === "wall")   setWalls   (prev => prev.map(r => r.id===dr.id ? merge(r, { x:nx, y:ny }) : r));
      if (dr.kind === "window") setWindows (prev => prev.map(r => r.id===dr.id ? merge(r, { x:nx, y:ny }) : r));
      if (dr.kind === "floor")  setFloors  (prev => prev.map(r => r.id===dr.id ? merge(r, { x:nx, y:ny }) : r));
      return;
    }
    const ir = itemResizeRef.current;
    if (ir.id) {
      const dx = e.clientX - ir.sx, dy = e.clientY - ir.sy;
      const d = Math.max(dx, dy);
      const size = Math.max(16, Math.min(256, Math.round(num(ir.start || 48) + d)));
      setItems((p) => p.map((x) => (x.id === ir.id ? merge(x, { size }) : x)));
      return;
    }
    const di = draggingItemRef.current;
    if (di.id) {
      const pt = screenToWorld(e.clientX, e.clientY);
      const nx = pt.x - di.dx, ny = pt.y - di.dy;
      setItems(prev => prev.map(it => it.id===di.id ? merge(it, { x:nx, y:ny }) : it));
      return;
    }
    if (activeTool && selecting && draft) {
      const pt = screenToWorld(e.clientX, e.clientY);
      setDraft(d => ({ ...d, end: { x: pt.x, y: pt.y } }));
    }
  };

  const onCanvasPointerUp = () => {
    if (itemResizeRef.current.id) {
      itemResizeRef.current = { id:null, start:0, sx:0, sy:0 };
      snapshot({ items:[...items] });
    }
    if (draggingItemRef.current.id) {
      draggingItemRef.current = { id:null, dx:0, dy:0 };
      snapshot({ items:[...items] });
    }
    if (rectResizeRef.current.id) {
      const k = rectResizeRef.current.kind;
      rectResizeRef.current = { kind:null, id:null, handle:null, start:null, startList:null };
      if (k==="wall") snapshot({ walls:[...walls] });
      if (k==="window") snapshot({ windows:[...windows] });
      if (k==="floor") snapshot({ floors:[...floors] });
    }
    if (draggingRectRef.current.id) {
      const k = draggingRectRef.current.kind;
      draggingRectRef.current = { kind:null, id:null, dx:0, dy:0, start:null };
      if (k==="wall") snapshot({ walls:[...walls] });
      if (k==="window") snapshot({ windows:[...windows] });
      if (k==="floor") snapshot({ floors:[...floors] });
    }
    if (panDragRef.current.active) panDragRef.current.active = false;
  };

  /* ===== zoom ===== */
  const applyZoomAt = (clientX, clientY, factor) => {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const curr = world.scale;
    const next = Math.min(5, Math.max(0.2, curr * factor));
    if (Math.abs(next - curr) < 1e-6) return;

    const wx = (clientX - (frame.left + frame.worldLeft)) / curr;
    const wy = (clientY - (frame.top  + frame.worldTop )) / curr;

    const newWorldLeft = clientX - wx * next - frame.left;
    const newWorldTop  = clientY - wy * next - frame.top;

    const newDispW = world.w * next;
    const newDispH = world.h * next;
    const centerLeft = (frame.cw - newDispW) / 2;
    const centerTop  = (frame.ch - newDispH) / 2;

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
  const nudgeZoom = (m) => {
    applyZoomAt(frame.left + frame.cw/2, frame.top + frame.ch/2, m);
  };

  /* ===== window prompt ===== */
  const submitWindowHeight = (e) => {
    e?.preventDefault?.();
    if (!windowPrompt) return;
    const raw = (windowPrompt.value ?? "").toString().trim().replace(",", ".");
    const val = Number(raw);
    if (!Number.isFinite(val) || val < 0) { setWindowPrompt((p)=>({...p, error:"Please enter a non-negative number (cm)."})); return; }
    const next = windows.map(w => w.id===windowPrompt.id ? { ...w, heightCm: val } : w);
    setWindows(next); snapshot({ windows: next }); setWindowPrompt(null);
  };
  const openWindowPrompt = (id, v) => setWindowPrompt({ id, value: (Number.isFinite(v)?String(v):""), error:"" });
  const onChangeWindowHeight = (e) => setWindowPrompt(p => p ? ({ ...p, value: e.target.value, error:"" }) : p);

  /* ===== undo/redo ===== */
  const undo = () => {
    if (!canUndo) return;
    const i = hIndex - 1; setHIndex(i);
    const s = history[i];
    setItems(s.items); setWalls(s.walls); setWindows(s.windows); setFloors(s.floors);
    setBgUrl(s.bgUrl); setWorld(s.world); setPan(s.pan); setBgImg(s.bgImg);
  };
  const redo = () => {
    if (!canRedo) return;
    const i = hIndex + 1; setHIndex(i);
    const s = history[i];
    setItems(s.items); setWalls(s.walls); setWindows(s.windows); setFloors(s.floors);
    setBgUrl(s.bgUrl); setWorld(s.world); setPan(s.pan); setBgImg(s.bgImg);
  };

  const toggleSelect = () => setSelectOpen(v=>!v);
  const ActiveLabel = activeTool ? (activeTool==="wall"?"Walls":activeTool==="window"?"Windows":"Floor") : "None";
  const clearAll = () => snapshot({ items:[], walls:[], windows:[], floors:[] });
  const removeItem = (id) => snapshot({ items: items.filter(i=>i.id!==id) });
  const clearBackground = () => { if (lastBgUrlRef.current) { try { URL.revokeObjectURL(lastBgUrlRef.current); } catch {} lastBgUrlRef.current=null; } snapshot({ bgUrl:null, bgImg:{w:0,h:0} }); };

  // simple safe exporter (prevents runtime errors)
  async function saveCompositionImage() {
    try {
      const node = canvasRef.current;
      if (!node) return;
      // Quick canvas snapshot of world area only (like screenshot)
      const cvs = document.createElement("canvas");
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      cvs.width = Math.max(1, Math.floor(world.w * world.scale)) * dpr;
      cvs.height = Math.max(1, Math.floor(world.h * world.scale)) * dpr;
      const ctx = cvs.getContext("2d"); if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#faf9f5"; ctx.fillRect(0,0,cvs.width/dpr,cvs.height/dpr);

      // draw bg
      if (bgUrl && bgImg.w && bgImg.h) {
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => { ctx.drawImage(img, Math.round(bgOffset.x*world.scale), Math.round(bgOffset.y*world.scale), Math.round(bgImg.w*world.scale), Math.round(bgImg.h*world.scale)); resolve(); };
          img.onerror = resolve; img.src = bgUrl;
        });
      }
      // rect helper
      const drawRects = (arr, color) => {
        ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = color; ctx.strokeStyle = color;
        for (const r of arr) { ctx.fillRect(Math.round(r.x*world.scale),Math.round(r.y*world.scale),Math.round(r.w*world.scale),Math.round(r.h*world.scale)); ctx.strokeRect(Math.round(r.x*world.scale),Math.round(r.y*world.scale),Math.round(r.w*world.scale),Math.round(r.h*world.scale)); }
        ctx.restore();
      };
      drawRects(floors, "#0a28a0"); drawRects(walls, "#ff4da6"); drawRects(windows, "#00a050");
      // icons
      for (const it of items) {
        const node = document.getElementById(it.id);
        if (!node) continue;
        const svg = node.querySelector("svg"); if (!svg) continue;
        const cloneSvg = svg.cloneNode(true);
        const svgStr = new XMLSerializer().serializeToString(cloneSvg);
        const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const sizePx = Math.max(16, Math.min(256, num(it.size || 48)));
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, Math.round(it.x*world.scale), Math.round(it.y*world.scale), Math.round(sizePx*world.scale), Math.round(sizePx*world.scale));
            URL.revokeObjectURL(url); resolve();
          };
          img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          img.src = url;
        });
      }
      const a = document.createElement("a"); a.href = cvs.toDataURL("image/png"); a.download = "composition.png"; document.body.appendChild(a); a.click(); a.remove();
    } catch(e) { console.error(e); }
  }

  /* ===== render ===== */
  const Handles = ({ kind, r }) => {
    if (!selecting) return null;
    const color = colorFor(kind);
    const mk = (pos, st, cursor) => (
      <div
        key={pos}
        role="button"
        aria-label={`Resize ${pos}`}
        style={{ ...styles.resizeHandle(color), ...st, cursor }}
        onPointerDown={(e) => onRectHandlePointerDown(e, kind, r.id, pos)}
      />
    );
    const left = r.x, top = r.y, w = r.w, h = r.h;
    const cx = left + w/2, cy = top + h/2;
    return (
      <>
        {mk("nw", { left: left-4,    top: top-4 },           "nwse-resize")}
        {mk("ne", { left: left+w-4,  top: top-4 },           "nesw-resize")}
        {mk("sw", { left: left-4,    top: top+h-4 },         "nesw-resize")}
        {mk("se", { left: left+w-4,  top: top+h-4 },         "nwse-resize")}
        {mk("n",  { left: cx-4,      top: top-4 },           "ns-resize")}
        {mk("s",  { left: cx-4,      top: top+h-4 },         "ns-resize")}
        {mk("w",  { left: left-4,     top: cy-4 },           "ew-resize")}
        {mk("e",  { left: left+w-4,   top: cy-4 },           "ew-resize")}
      </>
    );
  };

  return (
    <div
      style={styles.app}
      onMouseDown={() => { const ae = document.activeElement; if (ae && ae !== document.body && ae.blur) ae.blur(); }}
    >
      {/* toolbar */}
      <div style={styles.floaterBar}>
        <button aria-label="Save as image" style={styles.floaterBtn} title="Save as image" onClick={saveCompositionImage}>⬇️</button>
        <button aria-label="Zoom out" style={styles.floaterBtn} title="Zoom out" onClick={() => nudgeZoom(1/1.1)}>−</button>
        <button aria-label="Zoom in"  style={styles.floaterBtn} title="Zoom in"  onClick={() => nudgeZoom(1.1)}>＋</button>
        <button aria-label="Clear items/walls" style={styles.floaterBtn} title="Clear items & walls" onClick={clearAll}>🧹</button>
        <button aria-label="Remove background" style={styles.floaterBtn} title="Remove background" onClick={clearBackground}>🗑️</button>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={onInputChange} hidden />
      </div>

      {/* undo/redo */}
      <div style={styles.undoRedoBar}>
        <button style={styles.undoRedoBtn(canUndo)} onClick={undo} disabled={!canUndo}>⟲ Undo</button>
        <button style={styles.undoRedoBtn(canRedo)} onClick={redo} disabled={!canRedo}>⟳ Redo</button>
      </div>

      {/* right-center controls */}
      <div style={styles.stack}>
        <div style={styles.selectBtn(selectOpen)}>
          <div style={styles.header(selectOpen)} onClick={()=>setSelectOpen(v=>!v)} role="button" aria-label="Select tool">
            {`Select${selecting && activeTool ? ` • ${activeTool==="wall"?"Walls":activeTool==="window"?"Windows":"Floor"}` : ""}`}
          </div>
          {selectOpen && (
            <div style={styles.menu}>
              <div style={styles.item(activeTool==="wall",   "#ff4da6")} onClick={()=>chooseTool("wall")}>Walls</div>
              <div style={styles.item(activeTool==="window", "#00a050")} onClick={()=>chooseTool("window")}>Windows</div>
              <div style={styles.item(activeTool==="floor",  "#0a28a0")} onClick={()=>chooseTool("floor")}>Floor</div>
            </div>
          )}
        </div>
        <button style={styles.stopBtn} onClick={stopSelecting} aria-label="Stop selecting">Stop selecting</button>
      </div>

      {/* palette toggle */}
      <button aria-label="Toggle palette" onClick={() => setSidebarOpen((v) => !v)} style={styles.toggleHandle}>
        {sidebarOpen ? "‹" : "›"}
      </button>

      {/* palette */}
      <aside style={styles.sidebar(sidebarOpen)} aria-hidden={!sidebarOpen}>
        {PALETTE.map((p) => (
          <div
            key={p.type}
            draggable
            onDragStart={(e) => onPaletteDragStart(e, p.type)}
            style={styles.paletteCard}
            title={`Drag ${p.label}`}
          >
            {Icon[p.type]?.(48)}
            <div style={{ fontSize: 14 }}>{p.label}</div>
          </div>
        ))}
      </aside>

      {/* canvas */}
      <div
        ref={canvasRef}
        style={{ position:"relative", width:"100%", height:"100%", overflow:"hidden" }}
        onClick={handleCanvasClick}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerDown={onWorldPointerDown}
        onWheel={onWheel}
        onDragEnter={onCanvasDragOver}
        onDragOver={onCanvasDragOver}
        onDrop={onCanvasDrop}
      >
        {/* World (everything scales & pans together) */}
        {world.w > 0 && world.h > 0 && (
          <div
            style={{
              ...styles.world,
              left: frame.worldLeft,
              top:  frame.worldTop,
              width: world.w,
              height: world.h,
              transform: `scale(${world.scale})`,
            }}
          >
            {/* Background */}
            {bgUrl ? (
              <img
                src={bgUrl}
                alt="Background"
                draggable={false}
                style={{ ...styles.bgImg, width: bgImg.w, height: bgImg.h, left: bgOffset.x, top: bgOffset.y }}
              />
            ) : null}

            {/* Floors */}
            {floors.map(r => (
              <React.Fragment key={r.id}>
                <div style={{ ...styles.rect(COLORS.floor.fill, COLORS.floor.stroke), left: r.x, top: r.y, width: r.w, height: r.h }} onPointerDown={(e)=>onRectPointerDown(e, "floor", r.id)} />
                {selecting && <Handles kind="floor" r={r} />}
              </React.Fragment>
            ))}
            {/* Walls */}
            {walls.map(r => (
              <React.Fragment key={r.id}>
                <div style={{ ...styles.rect(COLORS.wall.fill, COLORS.wall.stroke), left: r.x, top: r.y, width: r.w, height: r.h }} onPointerDown={(e)=>onRectPointerDown(e, "wall", r.id)} />
                {selecting && <Handles kind="wall" r={r} />}
              </React.Fragment>
            ))}
            {/* Windows */}
            {windows.map(r => (
              <React.Fragment key={r.id}>
                <div
                  style={{ ...styles.rect(COLORS.window.fill, COLORS.window.stroke), left: r.x, top: r.y, width: r.w, height: r.h }}
                  onPointerDown={(e)=>onRectPointerDown(e, "window", r.id)}
                  onDoubleClick={(e)=>{ e.stopPropagation(); openWindowPrompt(r.id, r.heightCm); }}
                />
                {typeof r.heightCm === "number" && (
                  <div
                    style={{ ...styles.windowTag, left: r.x, top: r.y }}
                    role="button" tabIndex={0}
                    onClick={(e)=>{ e.stopPropagation(); openWindowPrompt(r.id, r.heightCm); }}
                    onKeyDown={(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); openWindowPrompt(r.id, r.heightCm); } }}
                  >
                    {r.heightCm} cm
                  </div>
                )}
                {selecting && <Handles kind="window" r={r} />}
              </React.Fragment>
            ))}

            {/* Items + resize knob */}
            {items.map(it => {
              const sizePx = Math.max(16, Math.min(256, num(it.size || 48)));
              const scale = sizePx / 48;
              return (
                <React.Fragment key={it.id}>
                  <div
                    id={it.id}
                    style={{ ...styles.placed, left: it.x, top: it.y, transform:`scale(${scale})`, transformOrigin:"top left" }}
                    onPointerDown={(e)=>onItemPointerDown(e, it.id)}
                    onDoubleClick={()=>removeItem(it.id)}
                  >
                    {Icon[it.type]?.(48)}
                  </div>
                  <div
                    role="button"
                    aria-label="Resize"
                    style={{
                      position: "absolute",
                      left: it.x + sizePx - 6,
                      top:  it.y + sizePx - 6,
                      zIndex: 13,
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
                    }}
                    onPointerDown={(e)=>onItemResizePointerDown(e, it.id)}
                  >
                    <span style={{ fontSize: 10, lineHeight: 1, userSelect: "none", pointerEvents: "none" }}>↘︎</span>
                  </div>
                </React.Fragment>
              );
            })}

            {/* Draft rectangle */}
            {activeTool && selecting && draft && (() => {
              const L = Math.min(draft.start.x, draft.end.x), T = Math.min(draft.start.y, draft.end.y);
              const W = Math.abs(draft.end.x - draft.start.x), H = Math.abs(draft.end.y - draft.start.y);
              const { fill, stroke } = COLORS[activeTool];
              const draftFill = fill.replace("0.35", "0.2");
              return <div style={{ ...styles.draft(draftFill, stroke), left:L, top:T, width:W, height:H }} />;
            })()}
          </div>
        )}

        {/* Empty state when no bg & before first draw */}
        {!bgUrl && (
          <div style={{ position:"absolute", inset:0, display:"grid", placeItems:"center", pointerEvents:"none" }}>
            <div style={{ textAlign:"center", color:"#666", pointerEvents:"auto" }}>
              <div style={{ fontSize:18, marginBottom:6 }}>Drop an image anywhere</div>
              <div style={{ fontSize:13, marginBottom:12, opacity:0.8 }}>or</div>
              <button onClick={()=>fileInputRef.current?.click()} style={styles.topChooseBtn}>Choose a file</button>
            </div>
          </div>
        )}
      </div>

      {/* Window height prompt */}
      {windowPrompt && (
        <form style={styles.note} onSubmit={submitWindowHeight}>
          <div style={{ fontWeight:700, marginBottom:6 }}>Window height above ground</div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <input
              autoFocus inputMode="decimal" placeholder="e.g. 40" aria-label="Height (cm)"
              value={windowPrompt.value} onChange={onChangeWindowHeight}
              style={{ width:120, height:30, padding:"0 10px", borderRadius:8, border:`1px solid ${windowPrompt.error?"#d33":"rgba(0,0,0,0.2)"}`, outline:"none" }}
            />
            <span>cm</span>
            <button type="submit" style={{ height:32, padding:"0 12px", borderRadius:8, border:"1px solid rgba(0,0,0,0.2)", background:"#fff", cursor:"pointer", fontWeight:700 }}>Save</button>
          </div>
          {windowPrompt.error && <div style={{ marginTop:6, color:"#d33", fontSize:12 }}>{windowPrompt.error}</div>}
          <div style={{ marginTop:6, fontSize:12, opacity:0.8 }}>Tip: decimals allowed, e.g., 37.5</div>
        </form>
      )}
    </div>
  );
}
