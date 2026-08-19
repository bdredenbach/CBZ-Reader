/* Longbox Native Page Turn — v59.2
 * Book-spine curl: continuous narrow strips with a stronger traveling fold.
 * No external libraries.
 */
window.LongboxNativePageTurn = class {
  constructor(reader) {
    this.reader = reader;
    this.running = false;
    this.duration = 820;
    this.stripCount = 96;
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
    layer.className = `native-spine-turn ${direction}`;
    layer.style.setProperty("--turn-duration", `${this.duration}ms`);
    layer.style.setProperty("--n", this.stripCount);

    const under = document.createElement("img");
    under.className = "native-spine-under";
    under.src = newUrl;
    under.draggable = false;
    under.alt = "";
    layer.appendChild(under);

    // Each strip is part of the same sheet. The only per-strip difference is
    // its position along the shared spine curve.
    for (let i = 0; i < this.stripCount; i++) {
      const piece = document.createElement("div");
      piece.className = "native-spine-piece";
      piece.style.setProperty("--i", i);

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

    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
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

    layer.addEventListener("animationend", finish, { once: true });
    setTimeout(finish, this.duration + 180);
    return true;
  }
};
