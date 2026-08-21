/* Longbox Page Mode — isolated Turn.js experiment
 * v57: initialize with exactly one page, then add remaining pages after the
 * Turn.js instance is interactive. This isolates initialization from the
 * multi-page/image-loading path that froze on mobile.
 */
window.LongboxPageMode = (() => {
  class PageMode {
    constructor({ getIssue, getPageUrl, getIndex, setIndex, onPageChanged, onState }) {
      this.getIssue = getIssue;
      this.getPageUrl = getPageUrl;
      this.getIndex = getIndex;
      this.setIndex = setIndex;
      this.onPageChanged = onPageChanged || (() => {});
      this.onState = onState || (() => {});
      this.host = null;
      this._hostStyle = null;
      this.book = null;
      this.issueKey = null;
      this.pageCount = 0;
      this._boundResize = () => this.resize();
      this._gesture = null;
      this._straightFold = null;
      this._boundGestureStart = (e) => this._gestureStart(e);
      this._boundGestureMove = (e) => this._gestureMove(e);
      this._boundGestureEnd = (e) => this._gestureEnd(e);
      this._destroyed = false;
    }

    async destroy() {
      this._destroyed = true;
      if (this.book) {
        try { this.book.turn("destroy"); } catch (_) {}
      }
      this.book = null;
      this.issueKey = null;
      this.pageCount = 0;
      window.removeEventListener("resize", this._boundResize);
      this._removeGestureGrab();
      this._removeStraightFoldLayer();
      if (this.host) {
        this.host.innerHTML = "";

        // Turn.js needs a heavily styled absolute host. Restore every inline
        // property it borrowed, not just display, before another mode renders.
        if (this._hostStyle === null) {
          this.host.removeAttribute("style");
        } else {
          this.host.setAttribute("style", this._hostStyle);
        }
      }
      this._hostStyle = null;
    }

    async waitForImage(img) {
      if (img.complete) return;
      await new Promise(resolve => {
        const done = () => resolve();
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
        setTimeout(done, 10000);
      });
    }

    makePage(url) {
      const page = document.createElement("div");
      page.className = "longbox-turn-page";
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.draggable = false;
      img.decoding = "async";
      img.loading = "eager";
      page.appendChild(img);
      return { page, img };
    }

    async render(host) {
      this._destroyed = false;
      this.host = host;
      // Remember the reader viewport's pre-Turn.js inline state so every
      // other reading mode gets the exact same container back on destroy.
      if (this._hostStyle === null) {
        this._hostStyle = host.getAttribute("style");
      }
      const issue = this.getIssue();
      if (!issue || !window.jQuery || !jQuery.fn.turn) {
        this.onState("Turn.js unavailable");
        return false;
      }

      const issueKey = issue.id ?? issue.key ?? issue.title ?? "issue";
      if (this.book && this.issueKey === issueKey) {
        this.host.style.display = "block";
        this.resize();
        return true;
      }

      await this.destroy();
      this._destroyed = false;

      host.style.display = "block";
      host.style.position = "absolute";
      host.style.inset = "0";
      host.style.width = "100%";
      host.style.height = "100%";
      host.style.overflow = "hidden";
      host.style.zIndex = "4";
      host.style.pointerEvents = "auto";

      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const rect = host.getBoundingClientRect();
      const width = Math.max(240, Math.round(rect.width || window.innerWidth));
      const height = Math.max(360, Math.round(rect.height || window.innerHeight));
      const pageCount = Math.max(1, Number(issue.pageCount) || 1);

      // Critical test: only the first page exists when Turn.js initializes.
      const firstUrl = await this.getPageUrl(0);
      if (!firstUrl) {
        this.onState("first-page-missing");
        return false;
      }

      const book = document.createElement("div");
      book.className = "longbox-turn-book";
      book.style.width = width + "px";
      book.style.height = height + "px";
      const first = this.makePage(firstUrl);
      book.appendChild(first.page);
      host.innerHTML = "";
      host.appendChild(book);

      await this.waitForImage(first.img);
      if (this._destroyed) return false;

      const $book = jQuery(book);
      this.pageCount = 1;
      this.onState("initializing=1");

      try {
        $book.turn({
          width,
          height,
          display: "single",
          autoCenter: true,
          gradients: true,
          acceleration: true,
          elevation: 0.05,
          duration: 600,
          direction: "ltr",
          pages: 1,
          page: 1
        });
      } catch (err) {
        this.onState("init-error=" + (err?.message || err));
        return false;
      }

      this.book = $book;
      this.issueKey = issueKey;
      this._installGestureGrab(book);
      this._installStraightFoldLayer();
      this.onState("ready=1");

      $book.bind("turned", (_event, page) => {
        const index = Math.max(0, Number(page) - 1);
        this.setIndex(index);
        this.onPageChanged(index);
      });
      $book.bind("turning", (_event, page) => this.onState(`turning=${page}`));

      window.addEventListener("resize", this._boundResize, { passive: true });

      // Now that Turn.js is alive, add pages one at a time. If a particular
      // page cannot be loaded, skip it rather than blocking the whole reader.
      this.onState(`adding=${pageCount - 1}`);
      for (let i = 1; i < pageCount; i++) {
        if (this._destroyed || !this.book) return false;
        const url = await this.getPageUrl(i);
        if (!url) continue;
        const { page, img } = this.makePage(url);
        await this.waitForImage(img);
        if (this._destroyed || !this.book) return false;
        try {
          this.book.turn("addPage", page, i + 1);
          this.pageCount = i + 1;
          this.onState(`added=${this.pageCount}`);
        } catch (err) {
          this.onState(`add-error=${i + 1}:${err?.message || err}`);
          break;
        }
      }

      if (!this._destroyed && this.book) {
        const target = Math.max(1, Math.min(Number(this.getIndex()) + 1, this.pageCount));
        try { this.book.turn("page", target); } catch (_) {}
        this.onState(`ready=${this.pageCount}`);
      }
      return true;
    }

    _installGestureGrab(book) {
      this._removeGestureGrab();
      // We only listen on the page book. Corner touches remain Turn.js's own
      // gesture path; this layer only activates after a deliberate middle drag.
      book.addEventListener("touchstart", this._boundGestureStart, { passive: true });
      book.addEventListener("touchmove", this._boundGestureMove, { passive: false });
      book.addEventListener("touchend", this._boundGestureEnd, { passive: true });
      book.addEventListener("touchcancel", this._boundGestureEnd, { passive: true });
      book.addEventListener("pointerdown", this._boundGestureStart, { passive: true });
      book.addEventListener("pointermove", this._boundGestureMove, { passive: false });
      book.addEventListener("pointerup", this._boundGestureEnd, { passive: true });
      book.addEventListener("pointercancel", this._boundGestureEnd, { passive: true });
      this._gestureBook = book;
    }

    _removeGestureGrab() {
      const book = this._gestureBook;
      if (!book) return;
      book.removeEventListener("touchstart", this._boundGestureStart);
      book.removeEventListener("touchmove", this._boundGestureMove);
      book.removeEventListener("touchend", this._boundGestureEnd);
      book.removeEventListener("touchcancel", this._boundGestureEnd);
      book.removeEventListener("pointerdown", this._boundGestureStart);
      book.removeEventListener("pointermove", this._boundGestureMove);
      book.removeEventListener("pointerup", this._boundGestureEnd);
      book.removeEventListener("pointercancel", this._boundGestureEnd);
      this._gestureBook = null;
      this._gesture = null;
    }

    _installStraightFoldLayer() {
      if (!this._gestureBook || this._straightFold) return;
      const layer = document.createElement("div");
      layer.className = "cbz-straight-fold-layer";
      layer.style.cssText =
        "position:absolute;inset:0;z-index:6;pointer-events:none;" +
        "display:none;overflow:hidden;perspective:1400px;";
      this._gestureBook.appendChild(layer);
      this._straightFold = { layer, active: false };
    }

    _removeStraightFoldLayer() {
      if (this._straightFold?.layer) this._straightFold.layer.remove();
      this._straightFold = null;
    }

    _straightFoldStart(direction, x, y) {
      const sf = this._straightFold;
      if (!sf) return false;

      const host = this._gestureBook;
      const img = host.querySelector(".page img, img");
      if (!img) return false;

      const rect = host.getBoundingClientRect();
      const source = img.currentSrc || img.src;
      if (!source) return false;

      sf.layer.innerHTML = "";
      sf.direction = direction;
      sf.x0 = x;
      sf.width = rect.width;
      sf.height = rect.height;
      sf.source = source;

      // Static back copy on the stationary side.
      const back = document.createElement("div");
      back.style.cssText =
        "position:absolute;inset:0;background:#fff url('" + source +
        "') center/contain no-repeat;transform:none;";

      // Folded sheet. Its left/right edge is the moving crease.
      const fold = document.createElement("div");
      fold.className = "cbz-straight-fold-sheet";
      fold.style.cssText =
        "position:absolute;top:0;width:100%;height:100%;" +
        "background:#fff url('" + source + "') center/contain no-repeat;" +
        "transform-origin:" + (direction === "next" ? "left center" : "right center") + ";" +
        "backface-visibility:hidden;" +
        "box-shadow:0 0 18px rgba(0,0,0,.16);" +
        "will-change:transform,clip-path;";

      sf.layer.appendChild(back);
      sf.layer.appendChild(fold);
      sf.back = back;
      sf.fold = fold;
      sf.active = true;
      sf.layer.style.display = "block";
      this._straightFoldMove(x);
      return true;
    }

    _straightFoldMove(x) {
      const sf = this._straightFold;
      if (!sf?.active || !sf.fold) return;

      const w = sf.width;
      const dx = x - sf.x0;
      const travel = Math.max(-w, Math.min(w, dx));

      // A middle grab is represented as a flat sheet rotating around a
      // vertical crease. This deliberately avoids Turn.js's corner curl.
      let progress = Math.max(0, Math.min(1,
        Math.abs(travel) / Math.max(1, w)));
      const angle = (sf.direction === "next" ? -1 : 1) * progress * 170;

      sf.fold.style.transform =
        "translateX(" + travel + "px) rotateY(" + angle + "deg)";

      const shadow = Math.min(.32, .06 + progress * .26);
      sf.fold.style.boxShadow =
        (sf.direction === "next" ? "-" : "") +
        "8px 0 18px rgba(0,0,0," + shadow.toFixed(3) + ")";
    }

    _straightFoldEnd(commit) {
      const sf = this._straightFold;
      if (!sf?.active) return;

      if (commit) {
        sf.fold.style.transition =
          "transform 180ms cubic-bezier(.22,.61,.36,1)";
        const final = sf.direction === "next" ? -180 : 180;
        sf.fold.style.transform =
          "translateX(" + (sf.direction === "next" ? sf.width : -sf.width) +
          "px) rotateY(" + final + "deg)";
      } else {
        sf.fold.style.transition =
          "transform 180ms cubic-bezier(.22,.61,.36,1)";
        sf.fold.style.transform = "translateX(0) rotateY(0deg)";
      }

      const layer = sf.layer;
      setTimeout(() => {
        if (layer === this._straightFold?.layer) {
          layer.style.display = "none";
          layer.innerHTML = "";
          this._straightFold.active = false;
        }
      }, 200);
    }

    _gestureStart(e) {
      if (!this.book || !this._gestureBook) return;
      const p = e.touches?.[0] || e;
      if (!p || typeof p.clientX !== "number") return;

      const rect = this._gestureBook.getBoundingClientRect();
      const x = p.clientX - rect.left;
      const y = p.clientY - rect.top;
      const corner = 110;
      const nearCorner =
        (x < corner || x > rect.width - corner) &&
        (y < corner || y > rect.height - corner);

      // Don't compete with Turn.js's native corner-grab gesture.
      if (nearCorner) {
        this._gesture = null;
        return;
      }

      this._gesture = {
        x0: p.clientX,
        y0: p.clientY,
        lastX: p.clientX,
        lastY: p.clientY,
        active: true,
        triggered: false,
        middle: true
      };
    }

    _gestureMove(e) {
      const g = this._gesture;
      if (!g || !g.active || !this.book) return;
      const p = e.touches?.[0] || e;
      if (!p || typeof p.clientX !== "number") return;

      const dx = p.clientX - g.x0;
      const dy = p.clientY - g.y0;
      g.lastX = p.clientX;
      g.lastY = p.clientY;

      if (!g.triggered) {
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;

        g.triggered = true;
        g.direction = dx < 0 ? "next" : "prev";

        const rect = this._gestureBook.getBoundingClientRect();
        const x = p.clientX - rect.left;
        const y = p.clientY - rect.top;

        if (!this._straightFoldStart(g.direction, x, y)) {
          g.triggered = false;
          return;
        }

        // Keep the real Turn.js engine out of the way for the middle grab.
        // Corner grabs still use Turn.js's native physics.
        e.preventDefault();
        return;
      }

      if (g.middle && this._straightFold?.active) {
        const rect = this._gestureBook.getBoundingClientRect();
        this._straightFoldMove(
          Math.max(1, Math.min(rect.width - 1, p.clientX - rect.left))
        );
        e.preventDefault();
      }
    }

    _gestureEnd() {
      const g = this._gesture;
      if (g && g.triggered && g.middle && this._straightFold?.active) {
        const rect = this._gestureBook.getBoundingClientRect();
        const dx = g.lastX - g.x0;
        const commit = Math.abs(dx) > Math.max(90, rect.width * 0.30);

        this._straightFoldEnd(commit);

        // Synchronize the reader after the visual experiment commits.
        if (commit) {
          if (g.direction === "next") this.onPageChanged(this.getIndex() + 1);
          else this.onPageChanged(this.getIndex() - 1);
        }
      }
      this._gesture = null;
    }

    resize() {
      if (!this.book || !this.host) return;
      const rect = this.host.getBoundingClientRect();
      const width = Math.max(240, Math.round(rect.width || window.innerWidth));
      const height = Math.max(360, Math.round(rect.height || window.innerHeight));
      try { this.book.turn("size", width, height); } catch (_) {}
    }

    next() { if (this.book) this.book.turn("next"); }
    prev() { if (this.book) this.book.turn("previous"); }
    goTo(index) {
      if (!this.book) return;
      const page = Math.max(1, Math.min(index + 1, this.pageCount));
      this.book.turn("page", page);
    }
  }
  return PageMode;
})();
