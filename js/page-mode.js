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
      this.book = null;
      this.issueKey = null;
      this.pageCount = 0;
      this.pageAspect = null;
      this.pageWidth = 0;
      this.pageHeight = 0;
      this._boundResize = () => this.resize();
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
      this.pageAspect = null;
      this.pageWidth = 0;
      this.pageHeight = 0;
      window.removeEventListener("resize", this._boundResize);
      if (this.host) {
        this.host.innerHTML = "";
        this.host.style.display = "none";
      }
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

    fitBookToHost() {
      if (!this.host || !this.book || !this.pageAspect) return;

      const rect = this.host.getBoundingClientRect();
      const maxWidth = Math.max(240, Math.round(rect.width * 0.88));
      const maxHeight = Math.max(360, Math.round(rect.height * 0.88));

      let width = Math.min(maxWidth, Math.round(maxHeight * this.pageAspect));
      let height = Math.round(width / this.pageAspect);

      if (height > maxHeight) {
        height = maxHeight;
        width = Math.round(height * this.pageAspect);
      }

      width = Math.max(240, width);
      height = Math.max(360, height);

      this.pageWidth = width;
      this.pageHeight = height;

      // Center the actual portrait page inside the usable reader area.
      this.book.css({
        width: width + "px",
        height: height + "px",
        left: Math.round((rect.width - width) / 2) + "px",
        top: Math.max(0, Math.round((rect.height - height) / 2 - rect.height * 0.18)) + "px"
      });

      try {
        this.book.turn("size", width, height);
      } catch (_) {}
    }

    setPageModeActive(active) {
      const stage = this.host || document.querySelector(".reader-stage");
      if (stage) stage.classList.toggle("page-mode-active", !!active);
      document.body.classList.toggle("page-mode-active", !!active);
    }

    async render(host) {
      this.setPageModeActive(true);
      this._destroyed = false;
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
      this._destroyed = false;

      host.style.display = "block";
      host.style.position = "absolute";
      // Keep the experimental flip surface inside the reader's usable area.
      // The reader chrome is a sibling overlay, so a full-screen Turn.js
      // surface can otherwise extend underneath the controls and steal touch
      // gestures. Reserve the top and bottom chrome areas while Page Mode is
      // active.
      host.style.top = "calc(52px + var(--safe-top, 0px))";
      host.style.right = "0";
      host.style.bottom = "calc(112px + var(--safe-bottom, 0px))";
      host.style.left = "0";
      host.style.width = "auto";
      host.style.height = "auto";
      host.style.overflow = "hidden";
      host.style.zIndex = "4";
      host.style.pointerEvents = "auto";

      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const rect = host.getBoundingClientRect();
      const hostWidth = Math.max(240, Math.round(rect.width || window.innerWidth));
      const hostHeight = Math.max(360, Math.round(rect.height || window.innerHeight));
      const pageCount = Math.max(1, Number(issue.pageCount) || 1);

      // Critical test: only the first page exists when Turn.js initializes.
      const firstUrl = await this.getPageUrl(0);
      if (!firstUrl) {
        this.onState("first-page-missing");
        return false;
      }

      const book = document.createElement("div");
      book.className = "longbox-turn-book";
      const first = this.makePage(firstUrl);
      book.appendChild(first.page);
      host.innerHTML = "";
      host.appendChild(book);

      await this.waitForImage(first.img);
      if (this._destroyed) return false;

      // Use the actual comic page's intrinsic aspect ratio rather than
      // stretching the Turn.js book to the whole reader rectangle.
      const naturalWidth = Number(first.img.naturalWidth) || 1;
      const naturalHeight = Number(first.img.naturalHeight) || 1;
      this.pageAspect = naturalWidth / naturalHeight;

      const maxWidth = Math.max(240, Math.round(hostWidth * 0.88));
      const maxHeight = Math.max(360, Math.round(hostHeight * 0.88));
      let width = Math.min(maxWidth, Math.round(maxHeight * this.pageAspect));
      let height = Math.round(width / this.pageAspect);
      if (height > maxHeight) {
        height = maxHeight;
        width = Math.round(height * this.pageAspect);
      }
      this.pageWidth = width;
      this.pageHeight = height;

      book.style.width = width + "px";
      book.style.height = height + "px";
      book.style.left = Math.round((hostWidth - width) / 2) + "px";
      book.style.top = Math.round((hostHeight - height) / 2) + "px";

      const $book = jQuery(book);
      this.pageCount = 1;
      this.onState("initializing=1");

      try {
        $book.turn({
          width,
          height,
          display: "single",
          autoCenter: false,
          gradients: false,
          acceleration: false,
          elevation: 0,
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

    resize() {
      if (!this.book || !this.host || !this.pageAspect) return;
      this.fitBookToHost();
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
