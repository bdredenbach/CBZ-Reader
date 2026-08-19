/* Longbox Native Page Turn — v59.5 Moving Fold Line
 * First-party moving-fold experiment.
 * No external libraries.
 */
window.LongboxNativePageTurn = class {
  constructor(reader) {
    this.reader = reader;
    this.running = false;
    this.duration = 940;
    this.samples = 140;
  }

  clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // The simulated hand grabs the outer top corner, travels diagonally,
  // and pulls the fold boundary across the sheet.
  cornerAt(t, forward, w, h) {
    const e = t < .5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2)/2;
    return forward
      ? { x: w * (1 - .94*e), y: h * (.06 + .52*Math.sin(Math.PI*e)) }
      : { x: w * (.94*e), y: h * (.06 + .52*Math.sin(Math.PI*e)) };
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

    const layer = document.createElement("div");
    layer.className = `native-moving-fold ${direction}`;
    layer.style.setProperty("--n", this.samples);
    layer.style.setProperty("--turn-duration", `${this.duration}ms`);

    const under = document.createElement("img");
    under.className = "native-moving-fold-under";
    under.src = newUrl;
    under.draggable = false;
    under.alt = "";
    layer.appendChild(under);

    for (let i = 0; i < this.samples; i++) {
      const piece = document.createElement("div");
      piece.className = "native-moving-fold-piece";
      piece.style.setProperty("--i", i);
      piece.style.setProperty("--n", this.samples);

      const img = document.createElement("img");
      img.src = oldUrl;
      img.draggable = false;
      img.alt = "";
      piece.appendChild(img);
      layer.appendChild(piece);
    }

    r.els.viewport.appendChild(layer);
    current.style.visibility = "hidden";
    layer.getBoundingClientRect();
    await new Promise(requestAnimationFrame);

    const pieces = [...layer.querySelectorAll(".native-moving-fold-piece")];
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
      try { await r.render(); }
      finally { this.running = false; }
    };

    const frame = now => {
      if (ended) return;

      const raw = Math.min(1, (now - start) / this.duration);
      const t = raw < .5
        ? 4*raw*raw*raw
        : 1 - Math.pow(-2*raw + 2, 3)/2;

      const corner = this.cornerAt(t, direction === "next", rect.width, rect.height);

      // Fold boundary travels from the grabbed edge toward the spine.
      const foldX = direction === "next"
        ? rect.width * (1 - .96*t)
        : rect.width * (.96*t);

      // The corner's vertical movement tilts the fold line.
      const slope = (corner.y - rect.height*.5) / Math.max(1, rect.width*.48);
      const foldY = rect.height*.5 + slope * (foldX - rect.width*.5);

      layer.style.setProperty("--fold-x", `${foldX}px`);
      layer.style.setProperty("--fold-y", `${foldY}px`);

      pieces.forEach((piece, i) => {
        const u = i/(pieces.length-1);
        const x = u * rect.width;

        // Signed distance from this slice to the moving fold line.
        const lineY = foldY + slope*(x-foldX);
        const signed = direction === "next"
          ? x - foldX
          : foldX - x;

        // Smooth transition zone around the fold. This is the key difference
        // from v59.4: the page is mostly flat until the fold reaches it.
        const width = rect.width * .16;
        const influence = this.clamp((signed + width)/width, 0, 1);

        // Traveling curl: the fold itself gets the strongest rotation/depth.
        const foldBand = Math.exp(-Math.pow(signed/(rect.width*.12), 2));
        const turnAngle = (direction === "next" ? -1 : 1) *
          (12 + 168*influence*influence);

        const verticalBend =
          (lineY - rect.height*.5) * .22 * foldBand;

        const depth =
          (38 + 82*foldBand) *
          Math.sin(Math.PI*t) *
          (0.25 + .75*foldBand);

        const pitch =
          slope * 20 * foldBand;

        const shade =
          .035 +
          .30*foldBand*Math.sin(Math.PI*t);

        piece.style.setProperty("--angle", `${turnAngle}deg`);
        piece.style.setProperty("--depth", `${depth}px`);
        piece.style.setProperty("--pitch", `${pitch}deg`);
        piece.style.setProperty("--lift", `${verticalBend}px`);
        piece.style.setProperty("--shade", shade.toFixed(3));
        piece.style.setProperty("--fold-band", foldBand.toFixed(3));
      });

      if (raw < 1) requestAnimationFrame(frame);
      else finish();
    };

    requestAnimationFrame(frame);
    return true;
  }
};
