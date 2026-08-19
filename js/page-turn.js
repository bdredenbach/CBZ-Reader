/* Longbox Native Page Turn — v59.3 Geometry Curl
 * First-party renderer using selective page-fold geometry concepts.
 * No StPageFlip/Turn.js dependency is included.
 */
window.LongboxNativePageTurn = class {
  constructor(reader) {
    this.reader = reader;
    this.running = false;
    this.duration = 900;
    this.samples = 120;
  }

  static dist(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  static rotatedPoint(p, origin, angle) {
    return {
      x: p.x * Math.cos(angle) + p.y * Math.sin(angle) + origin.x,
      y: p.y * Math.cos(angle) - p.x * Math.sin(angle) + origin.y
    };
  }

  // Same geometric relationship used by the reference implementation:
  // page position -> fold angle. We adapt it to a normalized animation point.
  calcFold(width, height, progress, forward) {
    const t = Math.max(0, Math.min(1, progress));
    // Start from the outer edge and travel toward the spine.
    const x = forward ? width * (1 - t) : width * t;
    const y = height * (0.50 + 0.10 * Math.sin(Math.PI * t));

    const left = width - x + 1;
    const top = Math.max(1, y);
    let angle = 2 * Math.acos(Math.min(1, left / Math.sqrt(top * top + left * left)));
    if (!Number.isFinite(angle)) angle = 0;

    // Forward and backward are mirror images.
    if (!forward) angle = -angle;

    // A continuous depth term gives the fold a physical "bow".
    const depth = 62 * Math.sin(Math.PI * t);

    return { x, y, angle, depth };
  }

  async turn(direction) {
    if (this.running) return false;
    const r = this.reader;
    if (!r.comic || r.mode !== "single" || r.scale > 1.02) return false;

    const to = direction === "next" ? r.index + 1 : r.index - 1;
    if (to < 0 || to >= r.comic.pageCount) return false;

    const current = r.els.viewport.querySelector("img");
    if (!current) return false;

    const oldUrl = current.currentSrc || current.src;
    const newUrl = await r.getPageUrl(to);
    if (!newUrl) return false;

    const rect = r.els.viewport.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return false;

    this.running = true;
    r.showChrome();

    const viewport = r.els.viewport;
    const layer = document.createElement("div");
    layer.className = `native-geometry-turn ${direction}`;
    layer.style.setProperty("--turn-duration", `${this.duration}ms`);
    layer.style.setProperty("--n", this.samples);

    const under = document.createElement("img");
    under.className = "native-geometry-under";
    under.src = newUrl;
    under.draggable = false;
    under.alt = "";
    layer.appendChild(under);

    for (let i = 0; i < this.samples; i++) {
      const piece = document.createElement("div");
      piece.className = "native-geometry-piece";
      piece.style.setProperty("--i", i);
      piece.style.setProperty("--n", this.samples);

      const img = document.createElement("img");
      img.src = oldUrl;
      img.draggable = false;
      img.alt = "";
      piece.appendChild(img);
      layer.appendChild(piece);
    }

    viewport.appendChild(layer);
    current.style.visibility = "hidden";
    layer.getBoundingClientRect();
    await new Promise(resolve => requestAnimationFrame(resolve));

    // Drive CSS custom properties from the actual fold geometry every frame.
    const pieces = [...layer.querySelectorAll(".native-geometry-piece")];
    const start = performance.now();
    let ended = false;

    const finish = async () => {
      if (ended) return;
      ended = true;
      layer.remove();
      current.style.visibility = "";
      r.index = to;
      r.updateSliderLabel();
      r.updateBookmarkFlag();
      r.saveProgress();
      try {
        await r.render();
      } finally {
        this.running = false;
      }
    };

    const frame = now => {
      if (ended) return;
      const raw = Math.min(1, (now - start) / this.duration);
      const ease = raw < .5
        ? 4 * raw * raw * raw
        : 1 - Math.pow(-2 * raw + 2, 3) / 2;

      const fold = this.calcFold(rect.width, rect.height, ease, direction === "next");
      layer.style.setProperty("--fold-x", `${fold.x}px`);
      layer.style.setProperty("--fold-y", `${fold.y}px`);
      layer.style.setProperty("--fold-depth", `${fold.depth}px`);
      layer.style.setProperty("--fold-angle", `${fold.angle}rad`);

      pieces.forEach((piece, i) => {
        const u = i / (pieces.length - 1);
        // The fold is a traveling wave. The center follows the fold most
        // strongly; edges lag smoothly behind it.
        const proximity = Math.exp(-Math.pow((u - (direction === "next" ? 1-ease : ease)) / .23, 2));
        const localAngle = fold.angle * (0.25 + 0.75 * proximity);
        const bow = fold.depth * Math.sin(Math.PI * u) * Math.sin(Math.PI * ease);
        const lift = bow * (0.72 + .28 * proximity);

        piece.style.setProperty("--local-angle", `${localAngle}rad`);
        piece.style.setProperty("--local-depth", `${lift}px`);
        piece.style.setProperty("--local-y", `${(u - .5) * -2.5 * Math.sin(Math.PI * ease)}px`);
        piece.style.setProperty("--shade", `${0.10 + .26 * proximity * Math.sin(Math.PI * ease)}`);
      });

      if (raw < 1) requestAnimationFrame(frame);
      else finish();
    };

    requestAnimationFrame(frame);
    return true;
  }
};
