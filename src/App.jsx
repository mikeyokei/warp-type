import { useState, useRef, useEffect, useCallback } from "react";
import opentype from "opentype.js";

const DEFAULT_TEXT = "BORN TO\nCHEER";
const CANVAS_W = 700;
const CANVAS_H = 600;

const INITIAL_POINTS = [
  { x: 100, y: 40 },
  { x: 600, y: 40 },
  { x: 640, y: 520 },
  { x: 60, y: 520 },
];

function solveProjection(src, dst) {
  const m = [], v = [];
  for (let i = 0; i < 4; i++) {
    m.push([src[i].x, src[i].y, 1, 0, 0, 0, -dst[i].x * src[i].x, -dst[i].x * src[i].y]);
    m.push([0, 0, 0, src[i].x, src[i].y, 1, -dst[i].y * src[i].x, -dst[i].y * src[i].y]);
    v.push(dst[i].x, dst[i].y);
  }
  const n = 8;
  for (let col = 0; col < n; col++) {
    let mr = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(m[row][col]) > Math.abs(m[mr][col])) mr = row;
    [m[col], m[mr]] = [m[mr], m[col]];[v[col], v[mr]] = [v[mr], v[col]];
    if (Math.abs(m[col][col]) < 1e-10) continue;
    for (let row = col + 1; row < n; row++) {
      const f = m[row][col] / m[col][col];
      for (let j = col; j < n; j++) m[row][j] -= f * m[col][j];
      v[row] -= f * v[col];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = v[i]; for (let j = i + 1; j < n; j++) x[i] -= m[i][j] * x[j]; x[i] /= m[i][i];
  }
  return (sx, sy) => {
    const d = x[6] * sx + x[7] * sy + 1;
    return { x: (x[0] * sx + x[1] * sy + x[2]) / d, y: (x[3] * sx + x[4] * sy + x[5]) / d };
  };
}

function lerp2(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

// Find the tight pixel bounding box of non-transparent pixels
function getInkBounds(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  let t = h, b = 0, l = w, r = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 0) {
        if (y < t) t = y; if (y > b) b = y;
        if (x < l) l = x; if (x > r) r = x;
      }
    }
  }
  if (t > b || l > r) return null;
  return { top: t, bottom: b + 1, left: l, right: r + 1 };
}

function renderDistortedText(destCtx, srcCanvas, srcBounds, corners, w, h) {
  const imgData = destCtx.createImageData(w, h);
  const srcCtx = srcCanvas.getContext("2d");
  const fullSrc = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const sw = srcCanvas.width;

  const bx = srcBounds.left, by = srcBounds.top;
  const bw = srcBounds.right - srcBounds.left;
  const bh = srcBounds.bottom - srcBounds.top;

  // Inverse mapping: dest quad corners → source ink bbox corners
  // For each dest pixel, find the corresponding source pixel
  const srcCorners = [
    { x: 0, y: 0 }, { x: bw, y: 0 }, { x: bw, y: bh }, { x: 0, y: bh }
  ];
  let inverseTransform;
  try { inverseTransform = solveProjection(corners, srcCorners); } catch { return; }

  // Find dest bounding box from the quad corners to limit iteration
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(w - 1, Math.ceil(maxX));
  maxY = Math.min(h - 1, Math.ceil(maxY));

  const srcData = fullSrc.data;

  for (let dy = minY; dy <= maxY; dy++) {
    for (let dx = minX; dx <= maxX; dx++) {
      // Map dest pixel back to source space
      const sp = inverseTransform(dx, dy);
      const sx = sp.x, sy = sp.y;

      // Skip if outside source ink bounds
      if (sx < 0 || sx >= bw || sy < 0 || sy >= bh) continue;

      // Bilinear interpolation
      const fx = Math.floor(sx), fy = Math.floor(sy);
      const fracX = sx - fx, fracY = sy - fy;
      const fx1 = Math.min(fx + 1, bw - 1), fy1 = Math.min(fy + 1, bh - 1);

      const i00 = ((by + fy) * sw + (bx + fx)) * 4;
      const i10 = ((by + fy) * sw + (bx + fx1)) * 4;
      const i01 = ((by + fy1) * sw + (bx + fx)) * 4;
      const i11 = ((by + fy1) * sw + (bx + fx1)) * 4;

      const w00 = (1 - fracX) * (1 - fracY);
      const w10 = fracX * (1 - fracY);
      const w01 = (1 - fracX) * fracY;
      const w11 = fracX * fracY;

      const r = srcData[i00] * w00 + srcData[i10] * w10 + srcData[i01] * w01 + srcData[i11] * w11;
      const g = srcData[i00 + 1] * w00 + srcData[i10 + 1] * w10 + srcData[i01 + 1] * w01 + srcData[i11 + 1] * w11;
      const b = srcData[i00 + 2] * w00 + srcData[i10 + 2] * w10 + srcData[i01 + 2] * w01 + srcData[i11 + 2] * w11;
      const a = srcData[i00 + 3] * w00 + srcData[i10 + 3] * w10 + srcData[i01 + 3] * w01 + srcData[i11 + 3] * w11;

      if (a < 1) continue;

      const di = (dy * w + dx) * 4;
      imgData.data[di] = r;
      imgData.data[di + 1] = g;
      imgData.data[di + 2] = b;
      imgData.data[di + 3] = a;
    }
  }
  destCtx.putImageData(imgData, 0, 0);
}

const BUILTIN_FONTS = [
  { name: "Impact", value: "Impact, sans-serif" },
  { name: "Arial Black", value: "'Arial Black', sans-serif" },
  { name: "Georgia", value: "Georgia, serif" },
  { name: "Courier", value: "'Courier New', monospace" },
  { name: "Times", value: "'Times New Roman', serif" },
];

const PRESETS = [
  { name: "Perspective ▼", pts: [{ x: 100, y: 40 }, { x: 600, y: 40 }, { x: 640, y: 520 }, { x: 60, y: 520 }] },
  { name: "Trapezoid ▲", pts: [{ x: 80, y: 60 }, { x: 620, y: 60 }, { x: 530, y: 520 }, { x: 170, y: 520 }] },
  { name: "Slant ◣", pts: [{ x: 120, y: 80 }, { x: 560, y: 20 }, { x: 600, y: 480 }, { x: 100, y: 540 }] },
  { name: "Diamond ◆", pts: [{ x: 350, y: 20 }, { x: 640, y: 280 }, { x: 350, y: 540 }, { x: 60, y: 280 }] },
  { name: "Flag ~", pts: [{ x: 60, y: 80 }, { x: 620, y: 30 }, { x: 640, y: 540 }, { x: 80, y: 440 }] },
  { name: "Expand ◇", pts: [{ x: 200, y: 20 }, { x: 500, y: 20 }, { x: 680, y: 540 }, { x: 20, y: 540 }] },
  { name: "Rectangle ■", pts: [{ x: 30, y: 30 }, { x: 670, y: 30 }, { x: 670, y: 570 }, { x: 30, y: 570 }] },
  { name: "Pinch ⊳", pts: [{ x: 60, y: 140 }, { x: 640, y: 220 }, { x: 640, y: 380 }, { x: 60, y: 460 }] },
];

const COLORS = ["#FFFFFF", "#FF3D00", "#FFEA00", "#00E5FF", "#FF00E5", "#76FF03", "#FF6D00", "#2979FF", "#000000", "#D500F9"];
const BG_COLORS = ["#0a0a0f", "#1a1a2e", "#0d1b2a", "#1b0a0a", "#ffffff", "#ff3d00", "#ffea00", "#00e5ff"];

export default function App() {
  const [text, setText] = useState(DEFAULT_TEXT);
  const [fontFamily, setFontFamily] = useState(BUILTIN_FONTS[0].value);
  const [textColor, setTextColor] = useState("#FFFFFF");
  const [bgColor, setBgColor] = useState("transparent");
  const [bold, setBold] = useState(true);
  const [italic, setItalic] = useState(false);
  const [letterSpacing, setLetterSpacing] = useState(0);
  const [lineHeight, setLineHeight] = useState(1.0);
  const [fontSize, setFontSize] = useState(200);
  const [stroke, setStroke] = useState(false);
  const [strokeColor, setStrokeColor] = useState("#000000");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [points, setPoints] = useState(INITIAL_POINTS.map(p => ({ ...p })));
  const [dragging, setDragging] = useState(null);
  const [showGrid, setShowGrid] = useState(true);
  const [customFonts, setCustomFonts] = useState([]);
  const [textAlign, setTextAlign] = useState("center");
  const canvasRef = useRef(null);
  const textCanvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const fontInputRef = useRef(null);
  const [canvasScale, setCanvasScale] = useState(1);
  const boundsRef = useRef(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setCanvasScale(Math.min(1, el.clientWidth / CANVAS_W)));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const handleFontUpload = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    for (const file of files) {
      const name = file.name.replace(/\.(otf|ttf|woff2?|eot)$/i, "");
      const url = URL.createObjectURL(file);
      try {
        const ff = new FontFace(name, `url(${url})`);
        const loaded = await ff.load();
        document.fonts.add(loaded);
        // Parse with opentype.js for vector SVG export
        let otFont = null;
        try {
          const buffer = await file.arrayBuffer();
          otFont = opentype.parse(buffer);
        } catch (otErr) { console.warn("opentype.js parse failed (vector SVG unavailable for this font):", otErr); }
        setCustomFonts(prev => prev.find(f => f.name === name) ? prev : [...prev, { name, value: `"${name}"`, otFont }]);
        setFontFamily(`"${name}"`);
      } catch (err) { console.error("Font load error:", err); }
    }
    e.target.value = "";
  };

  const renderText = useCallback(() => {
    if (!textCanvasRef.current) textCanvasRef.current = document.createElement("canvas");
    const tc = textCanvasRef.current;
    // Use a large canvas to render text at full size, then we find tight bounds
    const renderSize = Math.max(fontSize * 4, 2000);
    tc.width = renderSize;
    tc.height = renderSize;
    const ctx = tc.getContext("2d");
    ctx.clearRect(0, 0, renderSize, renderSize);

    const weight = bold ? "900" : "400";
    const style = italic ? "italic" : "normal";
    const lines = text.split("\n").filter(l => l.length > 0);
    if (!lines.length) { boundsRef.current = null; return; }

    ctx.font = `${style} ${weight} ${fontSize}px ${fontFamily}`;
    ctx.letterSpacing = `${letterSpacing}px`;
    ctx.textBaseline = "alphabetic";

    const lh = fontSize * lineHeight;
    // Render centered in the large canvas
    const startY = renderSize / 2 - (lines.length * lh) / 2 + fontSize * 0.8;

    lines.forEach((line, i) => {
      let x;
      if (textAlign === "left") { ctx.textAlign = "left"; x = 100; }
      else if (textAlign === "right") { ctx.textAlign = "right"; x = renderSize - 100; }
      else { ctx.textAlign = "center"; x = renderSize / 2; }
      const y = startY + i * lh;
      if (stroke) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.lineJoin = "round";
        ctx.strokeText(line, x, y);
      }
      ctx.fillStyle = textColor;
      ctx.fillText(line, x, y);
    });

    // Find tight pixel bounds
    boundsRef.current = getInkBounds(ctx, renderSize, renderSize);
  }, [text, fontFamily, textColor, bold, italic, letterSpacing, lineHeight, stroke, strokeColor, strokeWidth, fontSize, textAlign]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    if (bgColor !== "transparent") { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H); }

    renderText();

    if (boundsRef.current && textCanvasRef.current) {
      renderDistortedText(ctx, textCanvasRef.current, boundsRef.current, points, CANVAS_W, CANVAS_H);
    }

    if (showGrid) {
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const top = lerp2(points[0], points[1], t), bot = lerp2(points[3], points[2], t);
        ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(bot.x, bot.y); ctx.stroke();
        const lft = lerp2(points[0], points[3], t), rgt = lerp2(points[1], points[2], t);
        ctx.beginPath(); ctx.moveTo(lft.x, lft.y); ctx.lineTo(rgt.x, rgt.y); ctx.stroke();
      }
    }
  }, [points, renderText, bgColor, showGrid]);

  useEffect(() => { draw(); }, [draw]);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (cx - rect.left) * (CANVAS_W / rect.width), y: (cy - rect.top) * (CANVAS_H / rect.height) };
  };

  const onDown = (e) => {
    e.preventDefault();
    const pos = getPos(e);
    let closest = -1, minD = 40;
    points.forEach((p, i) => { const d = Math.hypot(p.x - pos.x, p.y - pos.y); if (d < minD) { minD = d; closest = i; } });
    if (closest >= 0) setDragging(closest);
  };

  const onMove = useCallback((e) => {
    if (dragging === null) return;
    e.preventDefault();
    const pos = getPos(e);
    setPoints(prev => { const n = [...prev]; n[dragging] = { x: Math.max(0, Math.min(CANVAS_W, pos.x)), y: Math.max(0, Math.min(CANVAS_H, pos.y)) }; return n; });
  }, [dragging]);
  const onUp = useCallback(() => setDragging(null), []);

  useEffect(() => {
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onUp); };
  }, [onMove, onUp]);

  const triggerDownload = (blob, filename) => {
    // Try native save dialog first (Chrome/Edge)
    if (window.showSaveFilePicker) {
      const ext = filename.split('.').pop();
      const types = ext === 'svg'
        ? [{ description: 'SVG Image', accept: { 'image/svg+xml': ['.svg'] } }]
        : [{ description: 'PNG Image', accept: { 'image/png': ['.png'] } }];
      window.showSaveFilePicker({ suggestedName: filename, types })
        .then(handle => handle.createWritable())
        .then(async writable => { await writable.write(blob); await writable.close(); })
        .catch(e => { if (e.name !== 'AbortError') console.error(e); });
      return;
    }
    // Fallback: blob URL download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  };

  const exportSVG = () => {
    // Find the current font's opentype.js data
    const currentCustomFont = customFonts.find(f => f.value === fontFamily);
    if (!currentCustomFont?.otFont) {
      setToast("Upload a font file for vector SVG export");
      setTimeout(() => setToast(""), 3000);
      return;
    }

    const font = currentCustomFont.otFont;
    const fScale = fontSize / font.unitsPerEm;
    const textLines = text.split("\n").filter(l => l.length > 0);
    if (!textLines.length) return;

    const lh = fontSize * lineHeight;

    // Calculate line widths for alignment (with kerning + letter spacing)
    const lineWidths = textLines.map(line => {
      let w = 0;
      for (let i = 0; i < line.length; i++) {
        const glyph = font.charToGlyph(line[i]);
        w += (glyph.advanceWidth || 0) * fScale;
        if (i < line.length - 1) {
          const nextGlyph = font.charToGlyph(line[i + 1]);
          w += (font.getKerningValue(glyph, nextGlyph) || 0) * fScale + letterSpacing;
        }
      }
      return w;
    });

    // Use the same virtual layout as the canvas renderer
    const renderSize = Math.max(fontSize * 4, 2000);
    const startY = renderSize / 2 - (textLines.length * lh) / 2 + fontSize * 0.8;

    // Collect all path commands
    const allCommands = [];

    textLines.forEach((line, lineIdx) => {
      let startX;
      const lineW = lineWidths[lineIdx];
      if (textAlign === "left") startX = 100;
      else if (textAlign === "right") startX = renderSize - 100 - lineW;
      else startX = (renderSize - lineW) / 2;

      const y = startY + lineIdx * lh;
      let currentX = startX;

      for (let i = 0; i < line.length; i++) {
        const glyph = font.charToGlyph(line[i]);
        const glyphPath = glyph.getPath(currentX, y, fontSize);
        allCommands.push(...glyphPath.commands);
        currentX += (glyph.advanceWidth || 0) * fScale;
        if (i < line.length - 1) {
          const nextGlyph = font.charToGlyph(line[i + 1]);
          currentX += (font.getKerningValue(glyph, nextGlyph) || 0) * fScale + letterSpacing;
        }
      }
    });

    if (!allCommands.length) return;

    // Find bounding box from all path control points
    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    for (const cmd of allCommands) {
      for (const k of ['x', 'x1', 'x2']) {
        if (cmd[k] !== undefined) { bMinX = Math.min(bMinX, cmd[k]); bMaxX = Math.max(bMaxX, cmd[k]); }
      }
      for (const k of ['y', 'y1', 'y2']) {
        if (cmd[k] !== undefined) { bMinY = Math.min(bMinY, cmd[k]); bMaxY = Math.max(bMaxY, cmd[k]); }
      }
    }

    const bw = bMaxX - bMinX;
    const bh = bMaxY - bMinY;
    if (bw <= 0 || bh <= 0) return;

    // Forward perspective projection: ink bbox corners → user quad
    const srcCorners = [
      { x: 0, y: 0 }, { x: bw, y: 0 }, { x: bw, y: bh }, { x: 0, y: bh }
    ];
    let transform;
    try { transform = solveProjection(srcCorners, points); } catch { return; }

    const tp = (px, py) => transform(px - bMinX, py - bMinY);

    // Build SVG path data from transformed commands
    let d = "";
    for (const cmd of allCommands) {
      switch (cmd.type) {
        case 'M': { const p = tp(cmd.x, cmd.y); d += `M${p.x.toFixed(2)} ${p.y.toFixed(2)}`; break; }
        case 'L': { const p = tp(cmd.x, cmd.y); d += `L${p.x.toFixed(2)} ${p.y.toFixed(2)}`; break; }
        case 'C': {
          const c1 = tp(cmd.x1, cmd.y1), c2 = tp(cmd.x2, cmd.y2), p = tp(cmd.x, cmd.y);
          d += `C${c1.x.toFixed(2)} ${c1.y.toFixed(2)} ${c2.x.toFixed(2)} ${c2.y.toFixed(2)} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
          break;
        }
        case 'Q': {
          const c1 = tp(cmd.x1, cmd.y1), p = tp(cmd.x, cmd.y);
          d += `Q${c1.x.toFixed(2)} ${c1.y.toFixed(2)} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
          break;
        }
        case 'Z': d += 'Z'; break;
      }
    }

    // Assemble final SVG
    const svgParts = [`<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">`];
    if (bgColor !== "transparent") svgParts.push(`<rect width="${CANVAS_W}" height="${CANVAS_H}" fill="${bgColor}"/>`);
    svgParts.push(`<path d="${d}" fill="${textColor}"${stroke ? ` stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="round"` : ""}/>`);
    svgParts.push(`</svg>`);

    triggerDownload(new Blob([svgParts.join("\n")], { type: "image/svg+xml" }), "distorted-text.svg");
  };

  const exportPNG = () => {
    canvasRef.current.toBlob((blob) => {
      triggerDownload(blob, "distorted-text.png");
    }, "image/png");
  };

  const LABELS = ["TL", "TR", "BR", "BL"];
  const allFonts = [...BUILTIN_FONTS, ...customFonts];

  const bounds = boundsRef.current;
  const inkW = bounds ? bounds.right - bounds.left : 0;
  const inkH = bounds ? bounds.bottom - bounds.top : 0;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e0e0e0", fontFamily: "'SF Mono','Fira Code',monospace" }}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        @keyframes gs{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
        .hdr{background:linear-gradient(135deg,#ff3d00,#ff00e5,#2979ff,#ff3d00);background-size:300% 300%;animation:gs 8s ease infinite;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
        .hdr h1{font-size:17px;font-weight:900;color:#fff;text-transform:uppercase;letter-spacing:3px;text-shadow:2px 2px 0 rgba(0,0,0,.3)}
        .hdr .tag{font-size:10px;background:rgba(0,0,0,.3);color:#fff;padding:3px 8px;border-radius:3px;letter-spacing:1px}
        .lay{display:flex;min-height:calc(100vh - 52px)}
        .side{width:272px;min-width:272px;background:#111118;border-right:1px solid #222;padding:14px;overflow-y:auto;max-height:calc(100vh - 52px)}
        .side::-webkit-scrollbar{width:4px}.side::-webkit-scrollbar-thumb{background:#333;border-radius:2px}
        .ca{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;gap:12px;background:radial-gradient(circle at 20% 80%,rgba(255,61,0,.04) 0%,transparent 50%),radial-gradient(circle at 80% 20%,rgba(0,229,255,.04) 0%,transparent 50%),#0a0a0f}
        .sec{font-size:9px;text-transform:uppercase;letter-spacing:2px;color:#555;margin:14px 0 6px;border-bottom:1px solid #1a1a24;padding-bottom:4px}
        .sec:first-child{margin-top:0}
        textarea{width:100%;background:#0a0a0f;border:1px solid #2a2a36;color:#fff;padding:8px 10px;font-family:inherit;font-size:13px;resize:vertical;min-height:56px;border-radius:4px;outline:none;transition:border-color .2s}
        textarea:focus{border-color:#ff3d00}
        .row{display:flex;gap:8px;align-items:center;margin-bottom:5px}
        .row label{font-size:11px;color:#777;min-width:52px;flex-shrink:0}
        input[type="range"]{flex:1;accent-color:#ff3d00;height:3px}
        .rv{font-size:11px;color:#ff3d00;min-width:32px;text-align:right;font-variant-numeric:tabular-nums}
        select{width:100%;background:#0a0a0f;border:1px solid #2a2a36;color:#fff;padding:6px 8px;font-family:inherit;font-size:12px;border-radius:4px;outline:none;cursor:pointer}
        .csw-row{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:5px}
        .csw{width:20px;height:20px;border-radius:3px;cursor:pointer;border:2px solid transparent;transition:all .15s;flex-shrink:0}
        .csw:hover{transform:scale(1.15)}.csw.on{border-color:#fff;box-shadow:0 0 6px rgba(255,255,255,.3)}
        .chk{display:flex;align-items:center;gap:6px;margin-bottom:5px;cursor:pointer;font-size:11px;color:#999}
        .chk input{accent-color:#ff3d00}
        .pgrid{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:5px}
        .pbtn{background:#16161e;border:1px solid #2a2a36;color:#999;padding:5px 6px;font-size:9px;font-family:inherit;cursor:pointer;border-radius:3px;text-transform:uppercase;letter-spacing:.5px;transition:all .15s}
        .pbtn:hover{background:#ff3d00;color:#fff;border-color:#ff3d00}
        .ubtn{width:100%;padding:8px;background:#16161e;border:1px dashed #444;color:#888;font-family:inherit;font-size:11px;cursor:pointer;border-radius:4px;transition:all .2s;margin-top:6px;text-align:center}
        .ubtn:hover{border-color:#ff3d00;color:#ff3d00;background:#1a1018}
        .abtn-row{display:flex;gap:3px;margin-bottom:5px}
        .abtn{flex:1;padding:5px;background:#16161e;border:1px solid #2a2a36;color:#888;font-size:12px;cursor:pointer;border-radius:3px;font-family:inherit;transition:all .15s}
        .abtn.on{background:#ff3d00;color:#fff;border-color:#ff3d00}
        .xbtns{display:flex;gap:6px;margin-top:10px}
        .xb{flex:1;padding:9px;font-family:inherit;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;border:none;border-radius:4px;cursor:pointer;transition:all .2s}
        .xb.s{background:#ff3d00;color:#fff}.xb.s:hover{background:#ff5722;transform:translateY(-1px)}
        .xb.p{background:#1a1a24;color:#fff;border:1px solid #333}.xb.p:hover{background:#2a2a36}
        .cvc{position:relative;cursor:crosshair;border-radius:4px;overflow:visible;box-shadow:0 0 60px rgba(255,61,0,.06),0 4px 30px rgba(0,0,0,.5)}
        .cvc canvas{display:block;border-radius:4px;background-image:linear-gradient(45deg,#1a1a1a 25%,transparent 25%),linear-gradient(-45deg,#1a1a1a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1a1a1a 75%),linear-gradient(-45deg,transparent 75%,#1a1a1a 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0;background-color:#141414}
        .cp{position:absolute;width:18px;height:18px;border-radius:50%;background:#ff3d00;border:2px solid #fff;transform:translate(-50%,-50%);cursor:grab;z-index:10;box-shadow:0 0 10px rgba(255,61,0,.5),0 2px 6px rgba(0,0,0,.4);transition:box-shadow .15s}
        .cp:hover,.cp.on{box-shadow:0 0 20px rgba(255,61,0,.8),0 2px 10px rgba(0,0,0,.5);transform:translate(-50%,-50%) scale(1.2)}
        .cp .lb{position:absolute;top:-17px;font-size:8px;font-weight:700;color:#ff3d00;letter-spacing:1px;pointer-events:none;text-shadow:0 1px 3px rgba(0,0,0,.8);white-space:nowrap}
        .el{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5}
        .ftag{display:inline-flex;align-items:center;gap:4px;background:#1e1028;border:1px solid #6a3d99;color:#c084fc;padding:2px 8px;border-radius:3px;font-size:10px;margin:2px}
        .ftag button{background:none;border:none;color:#c084fc;cursor:pointer;font-size:12px;padding:0;line-height:1;opacity:.6}
        .ftag button:hover{opacity:1}
        .metrics-bar{font-size:10px;color:#555;letter-spacing:1px;text-transform:uppercase;display:flex;gap:16px;padding:6px 12px;background:#111118;border-radius:4px;border:1px solid #1a1a24}
        .metrics-bar span{color:#ff3d00}
        .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#ff3d00;color:#fff;padding:10px 20px;border-radius:6px;font-size:12px;font-weight:600;letter-spacing:.5px;z-index:999;pointer-events:none;animation:toastIn .25s ease,toastOut .3s ease 2.7s forwards;box-shadow:0 4px 20px rgba(255,61,0,.4)}
        @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        @keyframes toastOut{to{opacity:0;transform:translateX(-50%) translateY(10px)}}
        @media(max-width:800px){.lay{flex-direction:column}.side{width:100%;min-width:100%;max-height:none;border-right:none;border-bottom:1px solid #222}.ca{padding:10px}}
      `}</style>

      <div className="hdr">
        <h1>Warp Type</h1>
        <span className="tag">Perspective Distortion · Font-Metric Fit</span>
      </div>

      <div className="lay">
        <div className="side">
          <div className="sec">Text</div>
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Type here..." />

          <div className="sec">Font</div>
          <select value={fontFamily} onChange={e => setFontFamily(e.target.value)}>
            {allFonts.map(f => <option key={f.value} value={f.value}>{f.name}</option>)}
          </select>
          <input ref={fontInputRef} type="file" accept=".otf,.ttf,.woff,.woff2" multiple style={{ display: "none" }} onChange={handleFontUpload} />
          <button className="ubtn" onClick={() => fontInputRef.current?.click()}>+ Upload Font (.otf .ttf .woff .woff2)</button>
          {customFonts.length > 0 && (
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 2 }}>
              {customFonts.map(f => (
                <span key={f.name} className="ftag">
                  {f.name}
                  <button onClick={() => { setCustomFonts(prev => prev.filter(cf => cf.name !== f.name)); if (fontFamily === f.value) setFontFamily(BUILTIN_FONTS[0].value); }}>×</button>
                </span>
              ))}
            </div>
          )}

          <div style={{ height: 6 }} />
          <div className="abtn-row">
            {["left", "center", "right"].map(a => (
              <button key={a} className={`abtn ${textAlign === a ? "on" : ""}`} onClick={() => setTextAlign(a)}>
                {a === "left" ? "◧" : a === "right" ? "◨" : "◫"}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <label className="chk"><input type="checkbox" checked={bold} onChange={e => setBold(e.target.checked)} /> Bold</label>
            <label className="chk"><input type="checkbox" checked={italic} onChange={e => setItalic(e.target.checked)} /> Italic</label>
          </div>

          <div className="sec">Size &amp; Spacing</div>
          <div className="row">
            <label>Size</label>
            <input type="range" min={20} max={600} value={fontSize} onChange={e => setFontSize(+e.target.value)} />
            <span className="rv">{fontSize}px</span>
          </div>
          <div className="row">
            <label>Tracking</label>
            <input type="range" min={-20} max={40} value={letterSpacing} onChange={e => setLetterSpacing(+e.target.value)} />
            <span className="rv">{letterSpacing}</span>
          </div>
          <div className="row">
            <label>Leading</label>
            <input type="range" min={0.5} max={2.0} step={0.05} value={lineHeight} onChange={e => setLineHeight(+e.target.value)} />
            <span className="rv">{lineHeight.toFixed(2)}</span>
          </div>

          <div className="sec">Colors</div>
          <div className="row"><label style={{ minWidth: 30 }}>Fill</label></div>
          <div className="csw-row">
            {COLORS.map(c => <div key={c} className={`csw ${textColor === c ? "on" : ""}`} style={{ background: c }} onClick={() => setTextColor(c)} />)}
          </div>
          <div className="row"><label style={{ minWidth: 30 }}>BG</label></div>
          <div className="csw-row">
            <div className={`csw ${bgColor === "transparent" ? "on" : ""}`} style={{ background: "linear-gradient(45deg,#333 25%,#666 25%,#666 50%,#333 50%,#333 75%,#666 75%)", backgroundSize: "8px 8px" }} onClick={() => setBgColor("transparent")} />
            {BG_COLORS.map(c => <div key={c} className={`csw ${bgColor === c ? "on" : ""}`} style={{ background: c }} onClick={() => setBgColor(c)} />)}
          </div>
          <label className="chk"><input type="checkbox" checked={stroke} onChange={e => setStroke(e.target.checked)} /> Stroke</label>
          {stroke && (<>
            <div className="csw-row">
              {["#000000", "#ffffff", "#ff3d00", "#ffea00", "#1a237e", "#00e5ff"].map(c => (
                <div key={c} className={`csw ${strokeColor === c ? "on" : ""}`} style={{ background: c }} onClick={() => setStrokeColor(c)} />
              ))}
            </div>
            <div className="row">
              <label>Width</label>
              <input type="range" min={1} max={20} value={strokeWidth} onChange={e => setStrokeWidth(+e.target.value)} />
              <span className="rv">{strokeWidth}</span>
            </div>
          </>)}

          <div className="sec">Shape Presets</div>
          <div className="pgrid">
            {PRESETS.map(p => <button key={p.name} className="pbtn" onClick={() => setPoints(p.pts.map(pt => ({ ...pt })))}>{p.name}</button>)}
          </div>
          <label className="chk"><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} /> Show Grid</label>

          <div className="xbtns">
            <button className="xb s" onClick={exportSVG}>⬇ SVG</button>
            <button className="xb p" onClick={exportPNG}>⬇ PNG</button>
          </div>
        </div>

        <div className="ca" ref={wrapperRef}>
          <div className="cvc" style={{ width: CANVAS_W * canvasScale, height: CANVAS_H * canvasScale }}>
            <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
              style={{ width: CANVAS_W * canvasScale, height: CANVAS_H * canvasScale }}
              onMouseDown={onDown} onTouchStart={onDown} />
            <svg className="el" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} style={{ width: CANVAS_W * canvasScale, height: CANVAS_H * canvasScale }}>
              <polygon points={points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="rgba(255,61,0,0.35)" strokeWidth="1.5" strokeDasharray="6 4" />
            </svg>
            {points.map((p, i) => (
              <div key={i} className={`cp ${dragging === i ? "on" : ""}`}
                style={{ left: p.x * canvasScale, top: p.y * canvasScale }}
                onMouseDown={e => { e.preventDefault(); setDragging(i); }}
                onTouchStart={e => { e.preventDefault(); setDragging(i); }}>
                <span className="lb">{LABELS[i]}</span>
              </div>
            ))}
          </div>
          <div className="metrics-bar">
            Ink bbox: <span>{inkW}×{inkH}</span>
            Font size: <span>{fontSize}px</span>
            Leading: <span>{lineHeight.toFixed(2)}</span>
          </div>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
