# Warp Type

A browser-based text distortion tool with perspective warping, custom font support, and true vector SVG export.

![Warp Type Preview](https://img.shields.io/badge/React-Vite-blue)

## Features

- **Perspective Text Distortion** — Drag corner handles to warp text into any quadrilateral shape
- **8 Shape Presets** — Perspective, Trapezoid, Slant, Diamond, Flag, Expand, Rectangle, Pinch
- **Custom Font Upload** — Upload `.otf`, `.ttf`, `.woff`, `.woff2` fonts
- **Vector SVG Export** — True vector `<path>` output using opentype.js (requires uploaded font)
- **PNG Export** — Raster export at canvas resolution
- **Live Controls** — Font size, tracking, leading, text alignment, fill color, background color, stroke
- **Responsive** — Works on desktop and mobile

## Getting Started

```bash
npm install
npm run dev
```

## Vector SVG Export

The SVG export generates **true vector paths** (not embedded bitmaps). It works by:
1. Parsing the uploaded font with [opentype.js](https://opentype.js.org/)
2. Extracting glyph outlines as path commands
3. Applying the perspective projection transform to every control point
4. Outputting clean SVG `<path>` elements

> **Note:** Vector export requires an uploaded font file. Built-in system fonts cannot be accessed for vector path extraction due to browser security restrictions.

## Tech Stack

- React + Vite
- opentype.js for font parsing
- Canvas 2D for live preview rendering
- Perspective homography for distortion math

## License

MIT
