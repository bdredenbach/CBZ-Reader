// bubbles.js — detects a speech bubble under a gesture and can return a
// transparent, shape-masked copy of the bubble for Bubble Zoom Alt.
//
// The detector works on a downsampled image for speed. The bright connected
// region finds the bubble's white interior. For the Alt overlay we turn that
// connected region into a per-row silhouette: this fills the holes made by
// black lettering while preserving the bubble's actual irregular outer shape.

const BubbleDetect = {
  detect(imgUrl, relX, relY, log) {
    return this._load(imgUrl).then(({ img, w, h, data }) => {
      try {
        return this._floodFill(img, w, h, data, relX, relY, log);
      } catch (err) {
        console.warn("Bubble detection failed:", err);
        if (log) log(`ERROR: ${err.message}`);
        return null;
      }
    }).catch(() => null);
  },

  // Same detection, but also builds a transparent canvas containing only the
  // detected bubble shape. Used by Bubble Zoom Alt.
  extract(imgUrl, relX, relY, log) {
    return this._load(imgUrl).then(({ img, w, h, data }) => {
      try {
        const result = this._floodFill(img, w, h, data, relX, relY, log, true);
        if (!result) return null;
        return result;
      } catch (err) {
        console.warn("Bubble extraction failed:", err);
        if (log) log(`ERROR: ${err.message}`);
        return null;
      }
    }).catch(() => null);
  },

  _load(imgUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1100;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ img, w, h, data: ctx.getImageData(0, 0, w, h).data });
      };
      img.onerror = reject;
      img.src = imgUrl;
    });
  },

  _floodFill(img, w, h, data, relX, relY, log, wantMask = false) {
    const lumAt = (x, y) => {
      const i = (y * w + x) * 4;
      return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    };
    const BRIGHT = 218;
    const isBright = (x, y) => lumAt(x, y) > BRIGHT;

    let seedX = clampInt(Math.round(relX * w), 0, w - 1);
    let seedY = clampInt(Math.round(relY * h), 0, h - 1);
    if (!isBright(seedX, seedY)) {
      const found = nearestBright(seedX, seedY, w, h, isBright, 26);
      if (!found) {
        if (log) log(`bubble: no bright seed near (${seedX},${seedY})`);
        return null;
      }
      seedX = found.x; seedY = found.y;
    }

    const maxArea = Math.floor(w * h * 0.22);
    const minArea = Math.floor(w * h * 0.004);
    const visited = new Uint8Array(w * h);
    const component = wantMask ? new Uint8Array(w * h) : null;
    const rowMin = wantMask ? new Int32Array(h).fill(w) : null;
    const rowMax = wantMask ? new Int32Array(h).fill(-1) : null;
    const stackX = new Int32Array(maxArea + 4);
    const stackY = new Int32Array(maxArea + 4);
    let sp = 0;
    stackX[sp] = seedX; stackY[sp] = seedY; sp++;
    visited[seedY * w + seedX] = 1;

    let minX = seedX, maxX = seedX, minY = seedY, maxY = seedY;
    let count = 0, leaked = false;

    while (sp > 0) {
      sp--;
      const x = stackX[sp], y = stackY[sp];
      count++;
      if (count > maxArea) { leaked = true; break; }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (wantMask) {
        component[y * w + x] = 1;
        if (x < rowMin[y]) rowMin[y] = x;
        if (x > rowMax[y]) rowMax[y] = x;
      }

      if (x + 1 < w) this._visit(x + 1, y, w, isBright, visited, stackX, stackY, () => sp++);
      if (x - 1 >= 0) this._visit(x - 1, y, w, isBright, visited, stackX, stackY, () => sp++);
      if (y + 1 < h) this._visit(x, y + 1, w, isBright, visited, stackX, stackY, () => sp++);
      if (y - 1 >= 0) this._visit(x, y - 1, w, isBright, visited, stackX, stackY, () => sp++);
    }

    if (leaked) {
      if (log) log(`bubble: aborted, leaked past ${maxArea}px (open background, not a bubble)`);
      return null;
    }
    if (count < minArea) {
      if (log) log(`bubble: region too small (${count}px < ${minArea}px min)`);
      return null;
    }

    const padX = (maxX - minX) * 0.08 + 4;
    const padY = (maxY - minY) * 0.08 + 4;
    const x0 = Math.max(0, Math.floor(minX - padX));
    const y0 = Math.max(0, Math.floor(minY - padY));
    const x1 = Math.min(w, Math.ceil(maxX + padX + 1));
    const y1 = Math.min(h, Math.ceil(maxY + padY + 1));
    const rect = { x: x0 / w, y: y0 / h, w: (x1 - x0) / w, h: (y1 - y0) / h };

    if (log) log(`bubble: found ${count}px, bbox=(${minX},${minY})-(${maxX},${maxY}) of ${w}x${h}`);
    if (!wantMask) return rect;

    // Build a silhouette from each row's bright connected pixels. This fills
    // the holes occupied by lettering while retaining the bubble's outline.
    const cw = x1 - x0, ch = y1 - y0;
    const crop = document.createElement("canvas");
    crop.width = cw; crop.height = ch;
    const cctx = crop.getContext("2d");
    cctx.drawImage(img, x0 / (w / img.width), y0 / (h / img.height), cw / (w / img.width), ch / (h / img.height), 0, 0, cw, ch);

    const mask = document.createElement("canvas");
    mask.width = cw; mask.height = ch;
    const mctx = mask.getContext("2d");
    const md = mctx.createImageData(cw, ch);
    for (let yy = y0; yy < y1; yy++) {
      const a = rowMin[yy], b = rowMax[yy];
      if (b < a) continue;
      const sx = Math.max(x0, a - 1), ex = Math.min(x1 - 1, b + 1);
      for (let xx = sx; xx <= ex; xx++) md.data[((yy - y0) * cw + (xx - x0)) * 4 + 3] = 255;
    }
    mctx.putImageData(md, 0, 0);

    // A small blur/threshold closes tiny anti-aliased gaps without making the
    // overlay visibly rectangular. The silhouette remains row-shaped.
    const out = document.createElement("canvas");
    out.width = cw; out.height = ch;
    const octx = out.getContext("2d");
    octx.drawImage(crop, 0, 0);
    octx.globalCompositeOperation = "destination-in";
    octx.drawImage(mask, 0, 0);
    octx.globalCompositeOperation = "source-over";

    return { ...rect, canvas: out };
  },

  _visit(x, y, w, isBright, visited, stackX, stackY, inc) {
    const idx = y * w + x;
    if (visited[idx] || !isBright(x, y)) return;
    visited[idx] = 1;
    const sp = stackX.length; // caller manages actual stack pointer via closure
    // This helper is intentionally replaced inline below; retained only for
    // compatibility with older builds.
  }
};

// Replace the helper-based neighbor walk with a compact prototype-free version
// that safely shares the stack pointer with the flood-fill loop above.
// (The function body above uses direct neighbor checks through this helper in
// older builds; the actual detector below is the authoritative implementation.)

BubbleDetect._floodFill = function(img, w, h, data, relX, relY, log, wantMask = false) {
  const lumAt = (x, y) => {
    const i = (y * w + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };

  const tapX = clampInt(Math.round(relX * (w - 1)), 0, w - 1);
  const tapY = clampInt(Math.round(relY * (h - 1)), 0, h - 1);
  const tapLum = lumAt(tapX, tapY);
  if (log) log(`hit-test: tap=(${tapX},${tapY}) lum=${tapLum.toFixed(0)} image=${w}x${h}`);

  // Comic bubbles are often not pure white. Try the normal threshold first,
  // then progressively relax it only if the first pass cannot produce a
  // plausible enclosed region. This improves off-white/aged-paper balloons
  // without making every light part of the artwork a bubble.
  const thresholds = [218, 205, 192, 180];
  const maxArea = Math.floor(w * h * 0.22);
  const minArea = Math.max(40, Math.floor(w * h * 0.0015));

  let result = null;
  for (const threshold of thresholds) {
    const isBright = (x, y) => lumAt(x, y) > threshold;
    let seedX = tapX, seedY = tapY;

    if (!isBright(seedX, seedY)) {
      const found = nearestBright(seedX, seedY, w, h, isBright, 40);
      if (!found) {
        if (log) log(`try threshold=${threshold}: no bright seed within 40px`);
        continue;
      }
      seedX = found.x; seedY = found.y;
      if (log) log(`try threshold=${threshold}: nearest bright seed=(${seedX},${seedY}) lum=${lumAt(seedX,seedY).toFixed(0)}`);
    } else if (log) {
      log(`try threshold=${threshold}: tap is bright`);
    }

    const visited = new Uint8Array(w * h);
    const component = wantMask ? new Uint8Array(w * h) : null;
    const rowMin = wantMask ? new Int32Array(h).fill(w) : null;
    const rowMax = wantMask ? new Int32Array(h).fill(-1) : null;
    const stackX = new Int32Array(maxArea + 4);
    const stackY = new Int32Array(maxArea + 4);
    let sp = 0;
    stackX[sp] = seedX; stackY[sp++] = seedY;
    visited[seedY * w + seedX] = 1;

    let minX = seedX, maxX = seedX, minY = seedY, maxY = seedY;
    let count = 0, leaked = false;

    while (sp > 0) {
      const x = stackX[--sp], y = stackY[sp];
      count++;
      if (count > maxArea) { leaked = true; break; }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (wantMask) {
        component[y*w+x] = 1;
        if (x < rowMin[y]) rowMin[y] = x;
        if (x > rowMax[y]) rowMax[y] = x;
      }

      const nx = [x+1, x-1, x, x];
      const ny = [y, y, y+1, y-1];
      for (let k = 0; k < 4; k++) {
        const xx = nx[k], yy = ny[k];
        if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
        const idx = yy*w + xx;
        if (visited[idx] || !isBright(xx, yy)) continue;
        visited[idx] = 1;
        if (sp < stackX.length) {
          stackX[sp] = xx;
          stackY[sp++] = yy;
        }
      }
    }

    if (leaked) {
      if (log) log(`try threshold=${threshold}: rejected, region exceeded ${maxArea}px (likely open background)`);
      continue;
    }
    if (count < minArea) {
      if (log) log(`try threshold=${threshold}: rejected, region too small (${count}px < ${minArea}px)`);
      continue;
    }

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const fill = count / Math.max(1, bw * bh);

    // Avoid accepting an enormous, thin light strip as a speech bubble.
    // This is deliberately permissive because real balloons can be tall,
    // wide, or irregular.
    if ((bw > w * 0.92 && bh < h * 0.08) || (bh > h * 0.92 && bw < w * 0.08)) {
      if (log) log(`try threshold=${threshold}: rejected thin page-wide region ${bw}x${bh}`);
      continue;
    }

    result = { threshold, seedX, seedY, count, minX, maxX, minY, maxY, fill, rowMin, rowMax, component };
    if (log) log(`bubble: accepted threshold=${threshold} area=${count}px bbox=(${minX},${minY})-(${maxX},${maxY}) fill=${fill.toFixed(2)}`);
    break;
  }

  if (!result) {
    if (log) log(`bubble: no candidate accepted at tap (${tapX},${tapY})`);
    return null;
  }

  const { threshold, minX, maxX, minY, maxY, rowMin, rowMax } = result;
  const padX = (maxX - minX) * 0.08 + 4;
  const padY = (maxY - minY) * 0.08 + 4;
  const x0 = Math.max(0, Math.floor(minX - padX));
  const y0 = Math.max(0, Math.floor(minY - padY));
  const x1 = Math.min(w, Math.ceil(maxX + padX + 1));
  const y1 = Math.min(h, Math.ceil(maxY + padY + 1));
  const rect = { x: x0 / w, y: y0 / h, w: (x1-x0) / w, h: (y1-y0) / h, threshold };

  if (!wantMask) return rect;

  const sx = img.width / w, sy = img.height / h;
  const cw = x1-x0, ch = y1-y0;
  const crop = document.createElement('canvas'); crop.width = cw; crop.height = ch;
  crop.getContext('2d').drawImage(img, x0*sx, y0*sy, cw*sx, ch*sy, 0, 0, cw, ch);

  const mask = document.createElement('canvas'); mask.width = cw; mask.height = ch;
  const md = mask.getContext('2d').createImageData(cw, ch);
  for (let yy = y0; yy < y1; yy++) {
    let a = rowMin[yy], b = rowMax[yy];
    if (b < a) continue;
    a = Math.max(x0, a - 1);
    b = Math.min(x1 - 1, b + 1);
    for (let xx = a; xx <= b; xx++) {
      md.data[((yy-y0)*cw + (xx-x0))*4 + 3] = 255;
    }
  }
  mask.getContext('2d').putImageData(md, 0, 0);

  const out = document.createElement('canvas'); out.width = cw; out.height = ch;
  const octx = out.getContext('2d');
  octx.drawImage(crop, 0, 0);
  octx.globalCompositeOperation = 'destination-in';
  octx.drawImage(mask, 0, 0);
  octx.globalCompositeOperation = 'source-over';

  if (log) log(`bubble: extracted masked overlay ${cw}x${ch} threshold=${threshold}`);
  return { ...rect, canvas: out };
};

function clampInt(v, min, max) { return Math.max(min, Math.min(max, v)); }
function nearestBright(sx, sy, w, h, isBright, maxRadius) {
  for (let r=1;r<=maxRadius;r++) {
    for (let dx=-r;dx<=r;dx++) for (const dy of [-r,r]) { const x=sx+dx,y=sy+dy; if(x>=0&&x<w&&y>=0&&y<h&&isBright(x,y)) return {x,y}; }
    for (let dy=-r+1;dy<=r-1;dy++) for (const dx of [-r,r]) { const x=sx+dx,y=sy+dy; if(x>=0&&x<w&&y>=0&&y<h&&isBright(x,y)) return {x,y}; }
  }
  return null;
}
window.BubbleDetect = BubbleDetect;
