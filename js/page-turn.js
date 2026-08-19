/* Longbox Native Page Turn — v60
 * Continuous single-surface page curl.
 * No external libraries.
 */
window.LongboxNativePageTurn = class {
  constructor(reader) {
    this.reader = reader;
    this.running = false;
    this.duration = 760;
  }

  async turn(direction) {
    if (this.running) return false;
    const r = this.reader;
    if (!r.comic || r.mode !== "single" || r.scale > 1.02) return false;

    const from = r.index;
    const to = direction === "next" ? from + 1 : from - 1;
    if (to < 0 || to >= r.comic.pageCount) return false;

    const current = r.els.viewport.querySelector("img");
    if (!current) return false;

    const oldUrl = current.currentSrc || current.src;
    const newUrl = await r.getPageUrl(to);
    if (!newUrl) return false;

    const rect = r.els.viewport.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return false;

    const oldImage = await this.loadImage(oldUrl);
    const newImage = await this.loadImage(newUrl);

    this.running = true;
    r.showChrome();

    const viewport = r.els.viewport;
    const layer = document.createElement("div");
    layer.className = `native-continuous-turn ${direction}`;
    layer.style.setProperty("--turn-duration", `${this.duration}ms`);

    const canvas = document.createElement("canvas");
    canvas.className = "native-continuous-turn-canvas";
    canvas.width = Math.max(1, Math.round(rect.width * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(rect.height * devicePixelRatio));
    layer.appendChild(canvas);

    const under = document.createElement("img");
    under.className = "native-continuous-turn-under";
    under.src = newUrl;
    under.draggable = false;
    under.alt = "";
    layer.appendChild(under);

    viewport.appendChild(layer);
    current.style.visibility = "hidden";

    const ctx = canvas.getContext("2d");
    const W = rect.width, H = rect.height;
    const dpr = devicePixelRatio || 1;

    // Preserve the reader's contain behavior when converting the comic image
    // into the canvas coordinate system.
    const contain = (img) => {
      const scale = Math.min(W / img.naturalWidth, H / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      return { x: (W - w) / 2, y: (H - h) / 2, w, h };
    };

    const oldBox = contain(oldImage);

    const draw = (progress) => {
      const p = direction === "next" ? progress : 1 - progress;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const cols = 180;
      const imageX = oldBox.x;
      const imageW = oldBox.w;

      // One mathematically continuous curved surface. Each vertical sample
      // shares the same curve, so unlike v59 there are no visible strip edges.
      for (let i = 0; i < cols; i++) {
        const u0 = i / cols;
        const u1 = (i + 1) / cols;
        const x0 = imageX + u0 * imageW;
        const x1 = imageX + u1 * imageW;

        const curl = Math.sin(u0 * Math.PI);
        const local = Math.max(0, Math.min(1, (u0 + p) / 1.0));
        const theta = -Math.PI * Math.min(1, Math.max(0, p + (u0 - 0.5) * 0.12));
        const depth = 55 * curl * Math.sin(Math.PI * p);

        ctx.save();
        ctx.translate((x0 + x1) / 2, H / 2 + depth * 0.08);
        ctx.rotate(theta * 0.16 * curl);

        const sx = u0 * oldImage.naturalWidth;
        const sw = Math.max(1, (u1 - u0) * oldImage.naturalWidth);

        ctx.globalAlpha = Math.max(0, 1 - p * 0.92);
        ctx.drawImage(
          oldImage,
          sx, 0, sw, oldImage.naturalHeight,
          -((x1 - x0) / 2), oldBox.y - H / 2,
          (x1 - x0) + 1, oldBox.h
        );

        // Continuous fold shading, not individual strip shading.
        const shade = Math.sin(u0 * Math.PI) * Math.sin(Math.PI * p);
        ctx.globalAlpha = shade * 0.20;
        ctx.fillStyle = "#000";
        ctx.fillRect(-((x1 - x0) / 2), oldBox.y - H / 2, (x1 - x0) + 1, oldBox.h);

        ctx.restore();
      }

      // A soft, moving specular highlight follows the fold.
      const gx = imageX + imageW * (0.15 + 0.7 * p);
      const grad = ctx.createLinearGradient(gx - 45, 0, gx + 45, 0);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(.5, "rgba(255,255,255,.18)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.globalAlpha = Math.sin(Math.PI * p);
      ctx.fillRect(gx - 45, oldBox.y, 90, oldBox.h);
      ctx.globalAlpha = 1;
    };

    const start = performance.now();

    await new Promise(resolve => {
      const frame = (now) => {
        const progress = Math.min(1, (now - start) / this.duration);
        // Smooth physical-looking acceleration/deceleration.
        const eased = progress < .5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        draw(eased);

        if (progress < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });

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
    return true;
  }

  loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }
};
