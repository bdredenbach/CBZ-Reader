/* Longbox Page Flip — v77 clean baseline experiment */
window.LongboxPageFlip = (() => {
  class PageFlip {
    constructor(reader) {
      this.reader = reader;
      this.host = reader.els.viewport;
      this.animating = false;
    }

    async turn(direction) {
      if (this.animating) return;
      const r = this.reader;
      if (r.mode !== "single") return;

      const from = r.index;
      const to = direction === "next" ? from + 1 : from - 1;
      if (to < 0 || to >= r.comic.pageCount) return;

      const oldImg = this.host.querySelector("img");
      if (!oldImg) {
        r.index = to;
        await r.render();
        return;
      }

      const oldSrc = oldImg.currentSrc || oldImg.src;
      const newSrc = await r.getPageUrl(to);
      if (!newSrc) return;

      this.animating = true;

      const stage = document.createElement("div");
      stage.className = "lb-pageflip-stage";
      const under = document.createElement("img");
      const sheet = document.createElement("img");

      under.className = "lb-pageflip-under";
      sheet.className = "lb-pageflip-sheet";
      under.src = newSrc;
      sheet.src = oldSrc;
      under.draggable = sheet.draggable = false;

      stage.append(under, sheet);
      this.host.appendChild(stage);

      const next = direction === "next";
      stage.classList.add(next ? "turn-next" : "turn-prev");

      await new Promise(resolve => {
        const done = () => {
          stage.removeEventListener("animationend", done);
          resolve();
        };
        stage.addEventListener("animationend", done, { once: true });
        setTimeout(done, 720);
      });

      stage.remove();
      r.index = to;
      r.updateSliderLabel();
      r.updateBookmarkFlag();
      r.saveProgress();
      r.loadPanelsForCurrentPage();
      this.animating = false;
    }
  }
  return PageFlip;
})();
