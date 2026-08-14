// reader.js — the reading experience: paging, zoom/pan, modes, themes

const Reader = {
  comic: null,
  pageUrls: [],       // object URLs, lazily filled
  index: 0,
  mode: "single",      // single | spread | scroll
  theme: "dark",        // dark | sepia | light
  scale: 1,
  tx: 0,
  ty: 0,
  chromeVisible: true,
  chromeTimer: null,

  els: {},

  init() {
    this.els.view = document.getElementById("reader-view");
    this.els.stage = document.getElementById("reader-stage");
    this.els.viewport = document.getElementById("page-viewport");
    this.els.chrome = document.getElementById("reader-chrome");
    this.els.title = document.getElementById("reader-title");
    this.els.slider = document.getElementById("page-slider");
    this.els.sliderLabel = document.getElementById("page-slider-label");
    this.els.loading = document.getElementById("reader-loading");
    this.els.bookmarkFlag = document.getElementById("bookmark-flag");

    document.getElementById("reader-back").addEventListener("click", () => this.close());
    document.getElementById("reader-bookmark").addEventListener("click", () => this.toggleBookmark());

    document.querySelectorAll(".mode-pill").forEach((btn) => {
      btn.addEventListener("click", () => this.setMode(btn.dataset.mode));
    });
    document.querySelectorAll(".theme-swatch").forEach((btn) => {
      btn.addEventListener("click", () => this.setTheme(btn.dataset.theme));
    });
    this.els.slider.addEventListener("input", (e) => {
      this.goTo(parseInt(e.target.value, 10), { fromSlider: true });
    });

    this.bindGestures();
  },

  async open(comicId) {
    this.comic = await LongboxDB.getComic(comicId);
    if (!this.comic) return;
    this.index = this.comic.lastPage || 0;
    this.mode = this.comic.readMode || "single";
    this.theme = this.comic.theme || "dark";
    this.pageUrls = new Array(this.comic.pageCount).fill(null);
    this.scale = 1; this.tx = 0; this.ty = 0;

    this.els.title.textContent = this.comic.title;
    this.els.slider.max = this.comic.pageCount - 1;
    this.applyTheme();
    this.applyModeClass();
    this.updateModePills();
    this.updateThemeSwatches();
    this.showChrome(true);

    await this.render();
  },

  close() {
    this.saveProgress();
    this.revokeAll();
    window.LongboxApp.closeReader();
  },

  revokeAll() {
    for (const url of this.pageUrls) {
      if (url) URL.revokeObjectURL(url);
    }
  },

  async getPageUrl(i) {
    if (i < 0 || i >= this.comic.pageCount) return null;
    if (this.pageUrls[i]) return this.pageUrls[i];
    const blob = await LongboxDB.getPage(this.comic.id, i);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.pageUrls[i] = url;
    return url;
  },

  async render() {
    this.resetZoom();
    if (this.mode === "scroll") {
      await this.renderScroll();
    } else {
      await this.renderPaged();
    }
    this.updateSliderLabel();
    this.updateBookmarkFlag();
    this.saveProgress();
  },

  async renderPaged() {
    this.els.stage.classList.remove("mode-scroll");
    this.els.viewport.innerHTML = "";
    this.els.loading.style.display = "flex";

    const indices = this.mode === "spread"
      ? [this.index, this.index + 1].filter((i) => i < this.comic.pageCount)
      : [this.index];

    const urls = await Promise.all(indices.map((i) => this.getPageUrl(i)));
    this.els.loading.style.display = "none";
    this.els.viewport.innerHTML = "";
    urls.forEach((url) => {
      if (!url) return;
      const img = document.createElement("img");
      img.src = url;
      img.draggable = false;
      this.els.viewport.appendChild(img);
    });
    this.prefetch();
  },

  async renderScroll() {
    this.els.stage.classList.add("mode-scroll");
    this.els.viewport.innerHTML = "";
    this.els.viewport.style.transform = "";

    const frag = document.createDocumentFragment();
    this.comic.pageCount && Array.from({ length: this.comic.pageCount }).forEach((_, i) => {
      const wrap = document.createElement("div");
      wrap.className = "scroll-page";
      wrap.dataset.index = i;
      const img = document.createElement("img");
      img.dataset.src = "pending";
      wrap.appendChild(img);
      frag.appendChild(wrap);
    });
    this.els.viewport.appendChild(frag);

    // lazy-load visible pages
    const io = new IntersectionObserver((entries) => {
      entries.forEach(async (entry) => {
        const wrap = entry.target;
        const i = parseInt(wrap.dataset.index, 10);
        if (entry.isIntersecting) {
          const img = wrap.querySelector("img");
          if (img.dataset.src === "pending") {
            img.dataset.src = "loading";
            const url = await this.getPageUrl(i);
            if (url) img.src = url;
          }
          this.index = i;
          this.updateSliderLabel();
          this.updateBookmarkFlag();
          this.throttledSaveProgress();
        }
      });
    }, { root: this.els.stage, threshold: 0.5 });

    this.els.stage.querySelectorAll(".scroll-page").forEach((el) => io.observe(el));
    this._scrollObserver = io;

    // jump to last read page
    requestAnimationFrame(() => {
      const target = this.els.stage.querySelector(`.scroll-page[data-index="${this.index}"]`);
      if (target) target.scrollIntoView({ block: "start" });
    });
  },

  prefetch() {
    const step = this.mode === "spread" ? 2 : 1;
    [this.index + step, this.index - 1].forEach((i) => this.getPageUrl(i));
  },

  applyModeClass() {
    this.els.viewport.className = "page-viewport";
    this.els.stage.classList.toggle("mode-spread", this.mode === "spread");
  },

  updateModePills() {
    document.querySelectorAll(".mode-pill").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === this.mode);
    });
  },

  updateThemeSwatches() {
    document.querySelectorAll(".theme-swatch").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.theme === this.theme);
    });
  },

  setMode(mode) {
    if (mode === this.mode) return;
    if (this._scrollObserver) { this._scrollObserver.disconnect(); this._scrollObserver = null; }
    this.mode = mode;
    this.comic.readMode = mode;
    LongboxDB.updateComic(this.comic.id, { readMode: mode });
    this.applyModeClass();
    this.updateModePills();
    this.render();
  },

  setTheme(theme) {
    this.theme = theme;
    this.comic.theme = theme;
    LongboxDB.updateComic(this.comic.id, { theme });
    this.applyTheme();
    this.updateThemeSwatches();
  },

  applyTheme() {
    this.els.view.classList.remove("theme-sepia", "theme-light");
    if (this.theme === "sepia") this.els.view.classList.add("theme-sepia");
    if (this.theme === "light") this.els.view.classList.add("theme-light");
  },

  updateSliderLabel() {
    this.els.slider.value = this.index;
    this.els.sliderLabel.textContent = `${this.index + 1} / ${this.comic.pageCount}`;
  },

  updateBookmarkFlag() {
    const marked = (this.comic.bookmarks || []).includes(this.index);
    this.els.bookmarkFlag.style.display = marked ? "block" : "none";
  },

  toggleBookmark() {
    const bookmarks = this.comic.bookmarks || (this.comic.bookmarks = []);
    const pos = bookmarks.indexOf(this.index);
    if (pos >= 0) bookmarks.splice(pos, 1);
    else bookmarks.push(this.index);
    LongboxDB.updateComic(this.comic.id, { bookmarks });
    this.updateBookmarkFlag();
  },

  goTo(i, opts = {}) {
    const step = this.mode === "spread" ? 2 : 1;
    i = Math.max(0, Math.min(this.comic.pageCount - 1, i));
    if (i === this.index && !opts.fromSlider) return;
    this.index = i;
    if (this.mode === "scroll") {
      const target = this.els.stage.querySelector(`.scroll-page[data-index="${i}"]`);
      if (target) target.scrollIntoView({ block: "start", behavior: opts.fromSlider ? "auto" : "smooth" });
      this.updateSliderLabel();
      this.updateBookmarkFlag();
      this.saveProgress();
    } else {
      this.render();
    }
  },

  next() {
    const step = this.mode === "spread" ? 2 : 1;
    this.goTo(this.index + step);
  },
  prev() {
    const step = this.mode === "spread" ? 2 : 1;
    this.goTo(this.index - step);
  },

  saveProgress() {
    if (!this.comic) return;
    LongboxDB.updateComic(this.comic.id, { lastPage: this.index });
  },
  throttledSaveProgress() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveProgress(), 400);
  },

  showChrome(persist) {
    this.chromeVisible = true;
    this.els.chrome.classList.add("visible");
    clearTimeout(this.chromeTimer);
    if (!persist) {
      this.chromeTimer = setTimeout(() => this.hideChrome(), 3200);
    }
  },
  hideChrome() {
    this.chromeVisible = false;
    this.els.chrome.classList.remove("visible");
  },
  toggleChrome() {
    if (this.chromeVisible) this.hideChrome();
    else this.showChrome();
  },

  resetZoom() {
    this.scale = 1; this.tx = 0; this.ty = 0;
    this.applyTransform();
  },
  applyTransform() {
    this.els.viewport.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
  },

  // ---------------- Gestures ----------------
  bindGestures() {
    const stage = this.els.stage;
    let touches = [];
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let panStart = null;
    let lastTapTime = 0;
    let lastTapPos = null;
    let dragMoved = false;

    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const mid = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

    stage.addEventListener("touchstart", (e) => {
      if (this.mode === "scroll") return; // native scroll handles this mode
      touches = Array.from(e.touches);
      dragMoved = false;
      if (touches.length === 2) {
        pinchStartDist = dist(touches[0], touches[1]);
        pinchStartScale = this.scale;
      } else if (touches.length === 1) {
        panStart = { x: touches[0].clientX, y: touches[0].clientY, tx: this.tx, ty: this.ty };
      }
    }, { passive: true });

    stage.addEventListener("touchmove", (e) => {
      if (this.mode === "scroll") return;
      touches = Array.from(e.touches);
      if (touches.length === 2) {
        e.preventDefault();
        const d = dist(touches[0], touches[1]);
        const newScale = clamp(pinchStartScale * (d / pinchStartDist), 1, 5);
        this.scale = newScale;
        this.applyTransform();
        dragMoved = true;
      } else if (touches.length === 1 && panStart) {
        const dx = touches[0].clientX - panStart.x;
        const dy = touches[0].clientY - panStart.y;
        if (this.scale > 1.02) {
          e.preventDefault();
          this.tx = panStart.tx + dx;
          this.ty = panStart.ty + dy;
          this.applyTransform();
          if (Math.abs(dx) > 6 || Math.abs(dy) > 6) dragMoved = true;
        } else if (Math.abs(dx) > 10) {
          dragMoved = true;
        }
      }
    }, { passive: false });

    stage.addEventListener("touchend", (e) => {
      if (this.mode === "scroll") return;
      const remaining = e.touches.length;
      const endTouch = e.changedTouches[0];

      if (remaining === 0) {
        if (this.scale <= 1.02) {
          this.scale = 1;
          this.constrainPan();
          // swipe-to-page only if it wasn't a drag-pan and there was real horizontal movement
          if (panStart) {
            const dx = endTouch.clientX - panStart.x;
            if (Math.abs(dx) > 60) {
              if (dx < 0) this.next(); else this.prev();
              panStart = null;
              return;
            }
          }
        } else {
          this.constrainPan();
        }

        if (!dragMoved) {
          // tap logic: double-tap to zoom, single tap to toggle chrome
          const now = Date.now();
          const pos = { x: endTouch.clientX, y: endTouch.clientY };
          const isDouble = now - lastTapTime < 300 &&
            lastTapPos && Math.hypot(pos.x - lastTapPos.x, pos.y - lastTapPos.y) < 40;
          if (isDouble) {
            this.handleDoubleTap(pos);
            lastTapTime = 0;
            lastTapPos = null;
          } else {
            lastTapTime = now;
            lastTapPos = pos;
            setTimeout(() => {
              if (Date.now() - lastTapTime >= 290) {
                this.handleSingleTap(pos);
              }
            }, 300);
          }
        }
        panStart = null;
      }
    });

    // Desktop convenience: wheel to zoom, click-drag to pan, click edges to page
    stage.addEventListener("wheel", (e) => {
      if (this.mode === "scroll") return;
      e.preventDefault();
      const delta = -e.deltaY * 0.0018;
      this.scale = clamp(this.scale + delta, 1, 5);
      if (this.scale <= 1.02) { this.scale = 1; this.tx = 0; this.ty = 0; }
      this.applyTransform();
    }, { passive: false });

    let mouseDown = false, mouseMoved = false, mStart = null;
    stage.addEventListener("mousedown", (e) => {
      if (this.mode === "scroll") return;
      mouseDown = true; mouseMoved = false;
      mStart = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
    });
    stage.addEventListener("mousemove", (e) => {
      if (!mouseDown || this.mode === "scroll") return;
      const dx = e.clientX - mStart.x, dy = e.clientY - mStart.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) mouseMoved = true;
      if (this.scale > 1.02) {
        this.tx = mStart.tx + dx;
        this.ty = mStart.ty + dy;
        this.applyTransform();
      }
    });
    stage.addEventListener("mouseup", (e) => {
      if (this.mode === "scroll") return;
      if (mouseDown && !mouseMoved) {
        this.handleSingleTap({ x: e.clientX, y: e.clientY });
      } else if (mouseDown && mouseMoved && this.scale <= 1.02) {
        const dx = e.clientX - mStart.x;
        if (Math.abs(dx) > 60) { if (dx < 0) this.next(); else this.prev(); }
      }
      mouseDown = false;
    });
    stage.addEventListener("dblclick", (e) => {
      if (this.mode === "scroll") return;
      this.handleDoubleTap({ x: e.clientX, y: e.clientY });
    });
  },

  handleSingleTap(pos) {
    const rect = this.els.stage.getBoundingClientRect();
    const relX = (pos.x - rect.left) / rect.width;
    if (this.scale <= 1.02) {
      if (relX < 0.25) { this.prev(); return; }
      if (relX > 0.75) { this.next(); return; }
    }
    this.toggleChrome();
  },

  // Double-tap: zoom into the tapped quadrant of the page ("panel" zoom),
  // or zoom back out if already zoomed.
  handleDoubleTap(pos) {
    const rect = this.els.stage.getBoundingClientRect();
    if (this.scale > 1.02) {
      this.resetZoom();
      return;
    }
    const relX = (pos.x - rect.left) / rect.width - 0.5;
    const relY = (pos.y - rect.top) / rect.height - 0.5;
    const targetScale = 2.4;
    this.scale = targetScale;
    this.tx = -relX * rect.width * (targetScale - 1);
    this.ty = -relY * rect.height * (targetScale - 1);
    this.constrainPan();
    this.applyTransform();
  },

  constrainPan() {
    const rect = this.els.stage.getBoundingClientRect();
    const maxX = (rect.width * (this.scale - 1)) / 2;
    const maxY = (rect.height * (this.scale - 1)) / 2;
    this.tx = clamp(this.tx, -maxX, maxX);
    this.ty = clamp(this.ty, -maxY, maxY);
    this.applyTransform();
  },
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

window.Reader = Reader;
