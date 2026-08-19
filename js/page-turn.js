/* Longbox Native Page Turn — v59.4 Corner Grab Curl
 * First-party corner-driven page geometry experiment.
 * No external libraries.
 */
window.LongboxNativePageTurn = class {
  constructor(reader) {
    this.reader = reader;
    this.running = false;
    this.duration = 920;
    this.samples = 120;
  }

  clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // Simulated finger/corner path. The page is "grabbed" at the outer corner
  // and pulled diagonally toward the spine rather than simply rotated.
  cornerAt(progress, forward, width, height) {
    const t = this.clamp(progress, 0, 1);
    const e = t < .5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2)/2;

    if (forward) {
      // Grab top-right and pull left/down, then settle toward the spine.
      return {
        x: width * (1 - .92 * e),
        y: height * (.06 + .56 * Math.sin(Math.PI * e))
      };
    }

    // Mirror: grab top-left and pull right/down.
    return {
      x: width * (.92 * e),
      y: height * (.06 + .56 * Math.sin(Math.PI * e))
    };
  }

  // Fold line from the active corner. This is a simplified reconstruction of
  // the corner/fold geometry: the fold normal follows the corner's movement,
  // and its distance from the page center controls the local bend.
  foldFromCorner(corner, width, height, forward) {
    const cx = width / 2;
    const cy = height / 2;
    const dx = corner.x - cx;
    const dy = corner.y - cy;
    const distance = Math.hypot(dx, dy) || 1;

    const nx = dx / distance;
    const ny = dy / distance;

    const angle = Math.atan2(ny, nx);
    const reach = this.clamp(distance / Math.hypot(width, height), 0, 1);

    return {
      nx, ny, angle,
      bend: (1 - reach) * Math.PI * .82 + Math.PI * .08,
      depth: 28 + 78 * Math.sin(Math.PI * reach)
    };
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
    layer.className = `native-corner-turn ${direction}`;
    layer.style.setProperty("--turn-duration", `${this.duration}ms`);
    layer.style.setProperty("--n", this.samples);

    const under = document.createElement("img");
    under.className = "native-corner-under";
    under.src = newUrl;
    under.draggable = false;
    under.alt = "";
    layer.appendChild(under);

    for (let i = 0; i < this.samples; i++) {
      const piece = document.createElement("div");
      piece.className = "native-corner-piece";
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

    const pieces = [...layer.querySelectorAll(".native-corner-piece")];
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
      const progress = raw < .5
        ? 4 * raw * raw * raw
        : 1 - Math.pow(-2 * raw + 2, 3) / 2;

      const corner = this.cornerAt(progress, direction === "next", rect.width, rect.height);
      const fold = this.foldFromCorner(corner, rect.width, rect.height, direction === "next");

      layer.style.setProperty("--corner-x", `${corner.x}px`);
      layer.style.setProperty("--corner-y", `${corner.y}px`);
      layer.style.setProperty("--fold-angle", `${fold.angle}rad`);

      pieces.forEach((piece, i) => {
        const u = i / (pieces.length - 1);

        // The active corner influences the nearby portion most strongly.
        // The influence then rolls smoothly across the sheet.
        const target = direction === "next" ? 1 - progress : progress;
        const influence = Math.exp(-Math.pow((u - target) / .30, 2));

        // Corner grab creates both horizontal rotation and a slight vertical
        // tilt, so the page can curl down/up as it travels.
        const yaw = (direction === "next" ? -1 : 1) *
          (8 + 142 * influence + 22 * Math.sin(Math.PI * progress) * Math.sin(Math.PI * u));

        const pitch = (corner.y / rect.height - .5) *
          (direction === "next" ? -1 : 1) *
          (12 + 26 * influence);

        const depth = fold.depth * Math.sin(Math.PI * u) *
          (0.35 + .65 * influence);

        const vertical = (corner.y - rect.height * .5) *
          influence * .18;

        const shade = .04 + .34 * influence * Math.sin(Math.PI * progress);

        piece.style.setProperty("--yaw", `${yaw}deg`);
        piece.style.setProperty("--pitch", `${pitch}deg`);
        piece.style.setProperty("--depth", `${depth}px`);
        piece.style.setProperty("--vertical", `${vertical}px`);
        piece.style.setProperty("--shade", shade.toFixed(3));
      });

      if (raw < 1) requestAnimationFrame(frame);
      else finish();
    };

    requestAnimationFrame(frame);
    return true;
  }
};
