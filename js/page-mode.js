/* Longbox Page Mode — isolated Turn.js experiment (v62)
 * Page mode only. The rest of Longbox remains coordinated by reader.js.
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
      this._eventShield = (e) => {
        e.stopPropagation();
      };
      this.book = null;
      this.issueKey = null;
      this.pageCount = 0;
      this._boundResize = () => this.resize();
    }

    async destroy() {
      if (this.book) {
        try { this.book.turn("destroy"); } catch (_) {}
      }
      this.book = null;
      this.issueKey = null;
      this.pageCount = 0;
      window.removeEventListener("resize", this._boundResize);
      if (this.host) {
        this.host.innerHTML = "";
        this.host.style.display = "none";
        for (const type of ["click","dblclick","pointerdown","pointerup","pointermove","touchstart","touchmove","touchend","mousedown","mouseup","mousemove"]) {
          this.host.removeEventListener(type, this._eventShield, true);
        }
      }
    }

    async render(host) {
      this.host = host;
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

      host.style.display = "block";
      host.style.position = "absolute";
      host.style.inset = "0";
      host.style.width = "100%";
      host.style.height = "100%";
      host.style.overflow = "hidden";
      host.style.zIndex = "50";
      host.style.pointerEvents = "auto";

      // This is a true interaction boundary. Page-mode gestures must never
      // bubble into Longbox's panel/bubble/focus handlers underneath.
      for (const type of ["click","dblclick","pointerdown","pointerup","pointermove","touchstart","touchmove","touchend","mousedown","mouseup","mousemove"]) {
        host.addEventListener(type, this._eventShield, true);
      }

      await new Promise(resolve =>
        requestAnimationFrame(() =>
          requestAnimationFrame(resolve)
        )
      );

      const rect = host.getBoundingClientRect();
      const width = Math.max(240, Math.round(rect.width || window.innerWidth));
      const height = Math.max(360, Math.round(rect.height || window.innerHeight));

      const book = document.createElement("div");
      book.className = "longbox-turn-book";
      book.style.width = width + "px";
      book.style.height = height + "px";

      for (let i = 0; i < issue.pageCount; i++) {
        const url = await this.getPageUrl(i);
        if (!url) continue;

        const page = document.createElement("div");
        page.className = "longbox-turn-page";

        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        img.draggable = false;
        img.decoding = "async";

        page.appendChild(img);
        book.appendChild(page);
      }

      host.innerHTML = "";
      host.appendChild(book);

      const $book = jQuery(book);
      this.pageCount = book.children.length;

      $book.turn({
        width,
        height,
        display: "single",
        autoCenter: true,
        gradients: true,
        acceleration: true,
        elevation: 70,
        duration: 850,
        direction: "ltr",
        page: Math.max(1, Math.min(this.getIndex() + 1, this.pageCount))
      });

      $book.bind("turned", (_event, page) => {
        const index = Math.max(0, Number(page) - 1);
        this.setIndex(index);
        this.onPageChanged(index);
      });

      $book.bind("turning", (_event, page) => {
        this.onState(`turning=${page}`);
      });

      this.book = $book;
      this.issueKey = issueKey;
      window.addEventListener("resize", this._boundResize, { passive: true });

      return true;
    }

    resize() {
      if (!this.book || !this.host) return;
      const rect = this.host.getBoundingClientRect();
      const width = Math.max(240, Math.round(rect.width || window.innerWidth));
      const height = Math.max(360, Math.round(rect.height || window.innerHeight));
      try {
        this.book.turn("size", width, height);
      } catch (_) {}
    }

    next() {
      if (this.book) this.book.turn("next");
    }

    prev() {
      if (this.book) this.book.turn("previous");
    }

    goTo(index) {
      if (this.book) {
        const page = Math.max(1, Math.min(index + 1, this.pageCount));
        this.book.turn("page", page);
      }
    }
  }

  return PageMode;
})();
