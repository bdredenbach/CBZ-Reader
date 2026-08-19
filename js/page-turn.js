/* Longbox Native Page Turn — v59.1
 * Continuous Strip Curl: many coordinated strips behaving as one sheet.
 * No external libraries.
 */
window.LongboxNativePageTurn = class {
  constructor(reader) {
    this.reader = reader;
    this.running = false;
    this.duration = 760;
    this.stripCount = 72;
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

    this.running = true;
    r.showChrome();

    const viewport = r.els.viewport;
    const layer = document.createElement("div");
    layer.className = `native-continuous-strip-turn ${direction}`;
    layer.style.setProperty("--turn-duration", `${this.duration}ms`);
    layer.style.setProperty("--strip-count", this.stripCount);

    const under = document.createElement("img");
    under.className = "native-strip-turn-under";
    under.src = newUrl;
    under.draggable = false;
    under.alt = "";
    layer.appendChild(under);

    const count = this.stripCount;
    for (let i = 0; i < count; i++) {
      const strip = document.createElement("div");
      strip.className = "native-strip-turn-piece";
      strip.style.setProperty("--i", i);
      strip.style.setProperty("--n", count);

      const img = document.createElement("img");
      img.src = oldUrl;
      img.draggable = false;
      img.alt = "";
      strip.appendChild(img);
      layer.appendChild(strip);
    }

    viewport.appendChild(layer);
    current.style.visibility = "hidden";

    // Force a clean initial frame.
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
    setTimeout(finish, this.duration + 160);
    return true;
  }
};
