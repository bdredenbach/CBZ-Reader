// bubbles.js — locates the speech bubble under a hold gesture via flood fill.
//
// Bubbles don't fit the panel-detector's row/column gutter-band approach
// (they're local blobs, not full-width/height bands). Instead: a speech
// bubble is almost always a near-uniform bright fill enclosed by a darker
// outline. Starting from the hold point, we flood-fill outward through only
// "bright" pixels — the outline naturally stops the fill — which gives a
// tight bounding box around just that bubble without needing to know its
// exact shape (oval, jagged "shout" bubble, tailed caption box, etc. all
// work the same way, since the fill only cares about connectivity).

const BubbleDetect = {
  // Returns a Promise<{x,y,w,h}|null> in fractional (0..1) page coordinates,
  // or null if no bubble-like region was found near (relX, relY).
  detect(imgUrl, relX, relY, log) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          resolve(this._floodFill(img, relX, relY, log));
        } catch (err) {
          console.warn("Bubble detection failed:", err);
          if (log) log(`ERROR: ${err.message}`);
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = imgUrl;
    });
  },

  _floodFill(img, relX, relY, log) {
    const maxDim = 1100;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const lumAt = (x, y) => {
      const i = (y * w + x) * 4;
      return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    };
    const BRIGHT = 218; // bubble fill is typically near-white
    const isBright = (x, y) => lumAt(x, y) > BRIGHT;

    let seedX = clampInt(Math.round(relX * w), 0, w - 1);
    let seedY = clampInt(Math.round(relY * h), 0, h - 1);

    // A hold often lands on a letter or the bubble's tail line rather than
    // open white space — search a small radius for the nearest bright pixel
    // to use as the real seed.
    if (!isBright(seedX, seedY)) {
      const found = nearestBright(seedX, seedY, w, h, isBright, 26);
      if (!found) {
        if (log) log(`bubble: no bright seed near (${seedX},${seedY})`);
        return null;
      }
      seedX = found.x;
      seedY = found.y;
    }

    const maxArea = Math.floor(w * h * 0.22); // beyond this we've leaked into open background
    const minArea = Math.floor(w * h * 0.004); // smaller than this is noise, not a real bubble

    const visited = new Uint8Array(w * h);
    const stackX = new Int32Array(maxArea + 4);
    const stackY = new Int32Array(maxArea + 4);
    let sp = 0;
    stackX[sp] = seedX;
    stackY[sp] = seedY;
    sp++;
    visited[seedY * w + seedX] = 1;

    let minX = seedX, maxX = seedX, minY = seedY, maxY = seedY;
    let count = 0;
    let leaked = false;

    while (sp > 0) {
      sp--;
      const x = stackX[sp];
      const y = stackY[sp];
      count++;
      if (count > maxArea) {
        leaked = true;
        break;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      // 4-connected neighbors
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const idx = ny * w + nx;
        if (visited[idx]) continue;
        if (!isBright(nx, ny)) continue;
        visited[idx] = 1;
        if (sp < stackX.length) {
          stackX[sp] = nx;
          stackY[sp] = ny;
          sp++;
        }
      }
    }

    if (leaked) {
      if (log) log(`bubble: aborted, leaked past ${maxArea}px (open background, not a bubble)`);
      return null;
    }
    if (count < minArea) {
      if (log) log(`bubble: region too small (${count}px < ${minArea}px min)`);
      return null;
    }

    // Pad outward a little so the zoom doesn't crop the bubble's own outline.
    const padX = (maxX - minX) * 0.08 + 4;
    const padY = (maxY - minY) * 0.08 + 4;
    const x0 = Math.max(0, minX - padX);
    const y0 = Math.max(0, minY - padY);
    const x1 = Math.min(w, maxX + padX);
    const y1 = Math.min(h, maxY + padY);

    if (log) log(`bubble: found ${count}px, bbox=(${minX},${minY})-(${maxX},${maxY}) of ${w}x${h}`);

    return { x: x0 / w, y: y0 / h, w: (x1 - x0) / w, h: (y1 - y0) / h };
  },
};

function clampInt(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Spiral/ring search outward from (sx,sy) for the nearest pixel passing
// isBright, up to maxRadius rings away.
function nearestBright(sx, sy, w, h, isBright, maxRadius) {
  for (let r = 1; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (const dy of [-r, r]) {
        const x = sx + dx, y = sy + dy;
        if (x >= 0 && x < w && y >= 0 && y < h && isBright(x, y)) return { x, y };
      }
    }
    for (let dy = -r + 1; dy <= r - 1; dy++) {
      for (const dx of [-r, r]) {
        const x = sx + dx, y = sy + dy;
        if (x >= 0 && x < w && y >= 0 && y < h && isBright(x, y)) return { x, y };
      }
    }
  }
  return null;
}

window.BubbleDetect = BubbleDetect;
