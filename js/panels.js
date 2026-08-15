// panels.js — detects panel boundaries on a comic page so double-tap zoom
// can snap to the actual panel instead of a geometric quadrant.
//
// Approach: classic gutter-scanning. Comic pages are almost always laid out
// as rows of panels separated by whitespace ("gutters"), with panels within
// a row separated by further whitespace. We downscale the page, measure how
// much "ink" (non-white content) sits in each row and column, and treat any
// sustained near-blank band as a gutter. This handles standard grid layouts
// well; painterly full-bleed pages with no clear gutters correctly yield no
// panels, and callers should fall back to geometric zoom in that case.

const PanelDetect = {
  // Returns a Promise<Array<{x,y,w,h}>> with fractional (0..1) page coordinates.
  // Resolves to [] if detection fails or the page doesn't look panelized.
  detect(imgUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          resolve(this._analyze(img));
        } catch (err) {
          console.warn("Panel detection failed:", err);
          resolve([]);
        }
      };
      img.onerror = () => resolve([]);
      img.src = imgUrl;
    });
  },

  _analyze(img) {
    const maxDim = 500;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const INK_LUMINANCE = 235; // below this, a pixel counts as "content" not blank page
    const isInk = (x, y) => {
      const i = (y * w + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      return lum < INK_LUMINANCE;
    };

    // Row ink ratio across the full width
    const rowInk = new Array(h);
    for (let y = 0; y < h; y++) {
      let count = 0;
      for (let x = 0; x < w; x++) if (isInk(x, y)) count++;
      rowInk[y] = count / w;
    }

    const gutterThresh = 0.015;
    const minRowGutter = Math.max(2, Math.round(h * 0.008));
    const minColGutter = Math.max(2, Math.round(w * 0.008));

    const strips = splitByGutter(rowInk, h, gutterThresh, minRowGutter);
    const panels = [];

    for (const [sy, ey] of strips) {
      const stripH = ey - sy;
      if (stripH < h * 0.05) continue; // sliver, likely noise

      const colInk = new Array(w);
      for (let x = 0; x < w; x++) {
        let count = 0;
        for (let y = sy; y < ey; y++) if (isInk(x, y)) count++;
        colInk[x] = count / stripH;
      }

      const cols = splitByGutter(colInk, w, gutterThresh, minColGutter);
      for (const [sx, ex] of cols) {
        const pw = ex - sx;
        if (pw < w * 0.05) continue;
        panels.push({ x: sx / w, y: sy / h, w: pw / w, h: stripH / h });
      }
    }

    // A single panel spanning basically the whole page isn't a useful
    // detection — treat it the same as "nothing found" so callers fall back.
    if (panels.length <= 1) return [];
    return panels;
  },
};

// Splits a 1D ink-ratio array into content spans, treating any sustained
// run of near-blank samples (>= minGutterRun long) as a separating gutter.
// Short blank runs (anti-aliasing, small gaps in art) are absorbed into
// whichever content span they sit inside rather than causing a false split.
function splitByGutter(inkArray, total, thresh, minGutterRun) {
  const spans = [];
  let contentStart = 0;
  let inGutterRun = false;
  let gutterRunStart = 0;

  for (let i = 0; i <= total; i++) {
    const isGutterSample = i < total ? inkArray[i] < thresh : true; // sentinel closes final run
    if (isGutterSample) {
      if (!inGutterRun) {
        inGutterRun = true;
        gutterRunStart = i;
      }
    } else if (inGutterRun) {
      const runLen = i - gutterRunStart;
      inGutterRun = false;
      if (runLen >= minGutterRun) {
        if (gutterRunStart - contentStart > 0) spans.push([contentStart, gutterRunStart]);
        contentStart = i;
      }
      // short run: not a real gutter, keep accumulating the current span
    }
  }
  if (total - contentStart > 0) spans.push([contentStart, total]);
  return spans;
}

window.PanelDetect = PanelDetect;
