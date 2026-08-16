// reader.js — the reading experience: paging, zoom/pan, modes, themes

const PANEL_ZOOM_KEY = "longbox_panel_zoom_enabled";
const BUBBLE_ZOOM_KEY = "longbox_bubble_zoom_enabled";
const BUBBLE_ALT_ZOOM_KEY = "longbox_bubble_alt_zoom_enabled";
const HOLD_MS = 500; // long-press duration to trigger bubble zoom

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

  currentPanels: [],       // detected panel rects for the visible page, fractional coords
  panelZoomEnabled: localStorage.getItem(PANEL_ZOOM_KEY) !== "0",
  bubbleZoomEnabled: localStorage.getItem(BUBBLE_ZOOM_KEY) !== "0",
  bubbleAltZoomEnabled: localStorage.getItem(BUBBLE_ALT_ZOOM_KEY) !== "0",
  bubbleOverlayActive: false,
  _panelLoadToken: 0,      // guards against a slow detection landing on the wrong page

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
    this.els.panelToggle = document.getElementById("panel-zoom-toggle");
    this.els.bubbleToggle = document.getElementById("bubble-zoom-toggle");
    this.els.bubbleAltToggle = document.getElementById("bubble-alt-zoom-toggle");
    this.els.debugPanel = document.getElementById("debug-panel");
    this.els.helpDrawer = document.getElementById("help-drawer");

    document.getElementById("reader-back").addEventListener("click", () => this.close());
    document.getElementById("reader-bookmark").addEventListener("click", () => this.toggleBookmark());
    document.getElementById("reader-help").addEventListener("click", () => this.openHelpDrawer());
    document.getElementById("help-drawer-close").addEventListener("click", () => this.closeHelpDrawer());
    this.els.helpDrawer.addEventListener("click", (e) => {
      if (e.target === this.els.helpDrawer) this.closeHelpDrawer();
    });
    this.els.panelToggle.addEventListener("click", () => this.togglePanelZoom());
    this.els.bubbleToggle.addEventListener("click", () => this.toggleBubbleZoom());
    this.els.bubbleAltToggle.addEventListener("click", () => this.toggleBubbleAltZoom());
    this.updatePanelToggleUI();
    this.updateBubbleToggleUI();
    this.updateBubbleAltToggleUI();
    this.bindDebugToggle();

    document.querySelectorAll(".reader-modes .mode-pill").forEach((btn) => {
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
    LongboxDB.updateComic(comicId, { lastOpenedAt: Date.now() });
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
    this.loadPanelsForCurrentPage();
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

  // Panel detection is only meaningful for a single displayed page, so we
  // skip it in spread/scroll modes (double-tap there falls back to
  // geometric zoom). Results are cached in IndexedDB per comic+page so
  // returning to a page later is instant.
  async loadPanelsForCurrentPage() {
    this.currentPanels = [];
    if (this.mode !== "single") return;

    const comicId = this.comic.id;
    const pageIndex = this.index;
    const token = ++this._panelLoadToken;
    // In debug mode, always re-run detection (bypass cache) so the diagnostic
    // log is populated every time — otherwise a cache hit would silently skip
    // straight past all the useful numbers.
    const logger = this.debugMode ? (msg) => this.debugLog(`[panels p${pageIndex}] ${msg}`) : null;

    let panels = this.debugMode ? undefined : await LongboxDB.getPanels(comicId, pageIndex);
    if (panels === undefined) {
      if (logger) logger("running detection" + (this.debugMode ? " (debug mode bypasses cache)" : " (not cached yet)"));
      const url = await this.getPageUrl(pageIndex);
      panels = url ? await PanelDetect.detect(url, logger) : [];
      LongboxDB.putPanels(comicId, pageIndex, panels);
    } else if (logger) {
      logger(`cache hit: ${panels.length} panel(s)`);
    }

    // If the reader has moved to a different comic/page since this started,
    // discard the result rather than applying it to the wrong page.
    if (token !== this._panelLoadToken || this.comic.id !== comicId || this.index !== pageIndex) return;
    this.currentPanels = panels;
    if (logger) logger(`currentPanels set: ${panels.length}`);
  },

  findPanelAt(relX, relY) {
    if (!this.panelZoomEnabled) return null;
    for (const p of this.currentPanels) {
      if (relX >= p.x && relX <= p.x + p.w && relY >= p.y && relY <= p.y + p.h) {
        return p;
      }
    }
    return null;
  },

  togglePanelZoom() {
    this.panelZoomEnabled = !this.panelZoomEnabled;
    localStorage.setItem(PANEL_ZOOM_KEY, this.panelZoomEnabled ? "1" : "0");
    this.updatePanelToggleUI();
  },
  updatePanelToggleUI() {
    this.els.panelToggle.classList.toggle("active", this.panelZoomEnabled);
  },

  toggleBubbleZoom() {
    this.bubbleZoomEnabled = !this.bubbleZoomEnabled;
    localStorage.setItem(BUBBLE_ZOOM_KEY, this.bubbleZoomEnabled ? "1" : "0");
    this.updateBubbleToggleUI();
  },
  updateBubbleToggleUI() {
    this.els.bubbleToggle.classList.toggle("active", this.bubbleZoomEnabled);
  },

  toggleBubbleAltZoom() {
    this.bubbleAltZoomEnabled = !this.bubbleAltZoomEnabled;
    localStorage.setItem(BUBBLE_ALT_ZOOM_KEY, this.bubbleAltZoomEnabled ? "1" : "0");
    this.updateBubbleAltToggleUI();
  },
  updateBubbleAltToggleUI() {
    this.els.bubbleAltToggle.classList.toggle("active", this.bubbleAltZoomEnabled);
  },

  removeBubbleOverlay() {
    if (this.els.bubbleOverlay) {
      this.els.bubbleOverlay.remove();
      this.els.bubbleOverlay = null;
    }
    this.bubbleOverlayActive = false;
  },

  openHelpDrawer() {
    this.els.helpDrawer.classList.add("open");
    this.showChrome(true);
  },
  closeHelpDrawer() {
    this.els.helpDrawer.classList.remove("open");
  },

  // ---------------- On-device gesture debugging ----------------
  // Tap the page title 5x quickly to toggle a live log of what the gesture
  // code actually sees on this device — real coordinates, timing, and which
  // branch it took — so we can diagnose from ground truth instead of guessing.
  debugMode: false,
  debugLines: [],
  bindDebugToggle() {
    let taps = 0;
    let resetTimer = null;
    this.els.title.addEventListener("click", () => {
      taps++;
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { taps = 0; }, 1500);
      if (taps >= 5) {
        taps = 0;
        this.debugMode = !this.debugMode;
        this.els.debugPanel.style.display = this.debugMode ? "block" : "none";
        this.debugLines = [];
        this.debugLog(this.debugMode ? "— debug on —" : "— debug off —");
        if (this.debugMode) {
          this.debugLog(`panelZoomEnabled=${this.panelZoomEnabled} bubbleZoomEnabled=${this.bubbleZoomEnabled} bubbleAltZoomEnabled=${this.bubbleAltZoomEnabled}`);
          if (this.comic) this.loadPanelsForCurrentPage();
        }
      }
    });
  },
  debugLog(msg) {
    if (!this.debugMode) return;
    const t = new Date().toISOString().slice(11, 23);
    this.debugLines.push(`${t} ${msg}`);
    if (this.debugLines.length > 40) this.debugLines.shift();
    this.els.debugPanel.textContent = this.debugLines.join("\n");
    this.els.debugPanel.scrollTop = this.els.debugPanel.scrollHeight;
  },

  applyModeClass() {
    this.els.viewport.className = "page-viewport";
    this.els.stage.classList.toggle("mode-spread", this.mode === "spread");
  },

  updateModePills() {
    document.querySelectorAll(".reader-modes .mode-pill").forEach((btn) => {
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
    this.debugLog(`setMode: ${this.mode} -> ${mode}`);
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
    this.debugLog(`showChrome(persist=${!!persist})`);
    this.chromeVisible = true;
    this.els.chrome.classList.add("visible");
    clearTimeout(this.chromeTimer);
    if (!persist) {
      this.chromeTimer = setTimeout(() => { this.debugLog("auto-hideChrome (3.2s timer)"); this.hideChrome(); }, 3200);
    }
  },
  hideChrome() {
    this.debugLog("hideChrome()");
    this.chromeVisible = false;
    this.els.chrome.classList.remove("visible");
  },
  toggleChrome() {
    if (this.chromeVisible) this.hideChrome();
    else this.showChrome();
  },

  resetZoom() {
    this.removeBubbleOverlay();
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
    let pinchStartMid = null;
    let pinchStartTx = 0;
    let pinchStartTy = 0;
    let wasPinching = false;
    let panStart = null;
    let lastTapTime = 0;
    let lastTapPos = null;
    let dragMoved = false;
    let pendingTapTimer = null;
    let holdTimer = null;
    let holdFired = false;

    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const mid = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

    // Long-press (hold): search for the speech bubble under the finger and
    // zoom in tight on it. Mirrors handleDoubleTap's structure — a hold
    // while already zoomed resets instead of searching again.
    const triggerHold = async (screenX, screenY) => {
      holdFired = true;
      dragMoved = true;
      panStart = null;

      if (!this.bubbleZoomEnabled || this.mode !== "single") {
        this.debugLog("hold: ignored (bubble zoom off or not in single-page mode)");
        return;
      }
      this.debugLog(`hold fired at (${screenX.toFixed(0)},${screenY.toFixed(0)}) scale=${this.scale.toFixed(2)}`);

      if (this.scale > 1.02) {
        this.debugLog("hold: already zoomed -> resetZoom()");
        this.resetZoom();
        return;
      }
      if (!this.comic) return;

      const stageRect = this.els.stage.getBoundingClientRect();
      const img = this.els.viewport.querySelector("img");
      const imgRect = img ? img.getBoundingClientRect() : stageRect;
      const relXImg = clamp((screenX - imgRect.left) / imgRect.width, 0, 1);
      const relYImg = clamp((screenY - imgRect.top) / imgRect.height, 0, 1);

      const comicId = this.comic.id;
      const pageIndex = this.index;
      const url = await this.getPageUrl(pageIndex);
      if (!url) return;
      const logger = this.debugMode ? (msg) => this.debugLog(`[bubble] ${msg}`) : null;
      const bubble = await BubbleDetect.detect(url, relXImg, relYImg, logger);

      // Bail if the reader moved on to a different comic/page while the
      // (async) flood fill was running.
      if (!this.comic || this.comic.id !== comicId || this.index !== pageIndex) return;

      if (bubble) {
        this.debugLog(`-> zoomToBubble ${JSON.stringify(bubble)}`);
        this.zoomToBubble(bubble, stageRect, imgRect);
      } else {
        this.debugLog("hold: no bubble found -> fallback zoomAtPoint");
        this.zoomAtPoint(screenX, screenY, 2.4, stageRect);
      }
    };

    stage.addEventListener("touchstart", (e) => {
      if (this.mode === "scroll") return; // native scroll handles this mode
      // Explicitly suppress the browser's own native double-tap-to-zoom /
      // pan gesture recognition. touch-action:none in CSS should already do
      // this, but some Chromium builds (Opera included) are inconsistent
      // about honoring it for the double-tap case specifically, so we also
      // block it at the JS level as a second layer.
      e.preventDefault();
      touches = Array.from(e.touches);
      dragMoved = false;
      this.debugLog(`touchstart n=${touches.length} scale=${this.scale.toFixed(2)}`);
      if (touches.length === 2) {
        pinchStartDist = Math.max(1, dist(touches[0], touches[1]));
        pinchStartScale = this.scale;
        pinchStartMid = mid(touches[0], touches[1]);
        pinchStartTx = this.tx;
        pinchStartTy = this.ty;
        wasPinching = true;
        panStart = null;
        clearTimeout(holdTimer);
        holdTimer = null;
      } else if (touches.length === 1) {
        panStart = { x: touches[0].clientX, y: touches[0].clientY, tx: this.tx, ty: this.ty };
        holdFired = false;
        clearTimeout(holdTimer);
        const hx = touches[0].clientX, hy = touches[0].clientY;
        holdTimer = setTimeout(() => triggerHold(hx, hy), HOLD_MS);
      }
    }, { passive: false });

    stage.addEventListener("touchmove", (e) => {
      if (this.mode === "scroll") return;
      touches = Array.from(e.touches);
      if (touches.length === 2) {
        e.preventDefault();
        const d = Math.max(1, dist(touches[0], touches[1]));
        const currentMid = mid(touches[0], touches[1]);
        const newScale = clamp(pinchStartScale * (d / pinchStartDist), 1, 5);

        // Keep the content point that was under the fingers anchored to the
        // moving midpoint. This makes pinch zoom behave like a native
        // focal-point zoom instead of scaling around the center of the page.
        const stageRect = stage.getBoundingClientRect();
        const centerX = stageRect.left + stageRect.width / 2;
        const centerY = stageRect.top + stageRect.height / 2;
        const startContentX = (pinchStartMid.x - centerX - pinchStartTx) / pinchStartScale;
        const startContentY = (pinchStartMid.y - centerY - pinchStartTy) / pinchStartScale;

        this.scale = newScale;
        this.tx = currentMid.x - centerX - startContentX * newScale;
        this.ty = currentMid.y - centerY - startContentY * newScale;
        this.constrainPan();
        dragMoved = true;
        clearTimeout(holdTimer);
        holdTimer = null;
      } else if (touches.length === 1 && panStart) {
        const dx = touches[0].clientX - panStart.x;
        const dy = touches[0].clientY - panStart.y;
        if (this.scale > 1.02) {
          e.preventDefault();
          this.tx = panStart.tx + dx;
          this.ty = panStart.ty + dy;
          this.applyTransform();
          if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
            if (!dragMoved) this.debugLog(`touchmove -> dragMoved (zoomed) dx=${dx.toFixed(0)} dy=${dy.toFixed(0)}`);
            dragMoved = true;
            clearTimeout(holdTimer);
            holdTimer = null;
          }
        } else if (Math.abs(dx) > 10) {
          if (!dragMoved) this.debugLog(`touchmove -> dragMoved (flat) dx=${dx.toFixed(0)}`);
          dragMoved = true;
          clearTimeout(holdTimer);
          holdTimer = null;
        }
      }
    }, { passive: false });

    stage.addEventListener("touchend", (e) => {
      if (this.mode === "scroll") return;
      e.preventDefault();
      clearTimeout(holdTimer);
      holdTimer = null;
      const remaining = e.touches.length;
      const endTouch = e.changedTouches[0];

      // A hold already fired (and already consumed this gesture, either as a
      // bubble zoom or a zoom-reset) — nothing left to classify as a tap.
      if (remaining === 0 && holdFired) {
        holdFired = false;
        wasPinching = false;
        panStart = null;
        return;
      }

      // When a pinch ends with one finger still down, start a fresh pan
      // reference from that finger so the page doesn't jump.
      if (remaining === 1 && wasPinching) {
        const t = e.touches[0];
        panStart = { x: t.clientX, y: t.clientY, tx: this.tx, ty: this.ty };
        wasPinching = false;
        dragMoved = true;
        return;
      }

      if (remaining === 0) {
        this.debugLog(`touchend scale=${this.scale.toFixed(2)} dragMoved=${dragMoved} pos=(${endTouch.clientX.toFixed(0)},${endTouch.clientY.toFixed(0)})`);
        if (this.scale <= 1.02) {
          this.scale = 1;
          this.constrainPan();
          // swipe-to-page only if it wasn't a drag-pan and there was real horizontal movement
          if (panStart) {
            const dx = endTouch.clientX - panStart.x;
            if (Math.abs(dx) > 60) {
              this.debugLog(`-> swipe page-turn dx=${dx.toFixed(0)}`);
              if (dx < 0) this.next(); else this.prev();
              panStart = null;
              return;
            }
          }
        } else {
          this.constrainPan();
        }

        if (!dragMoved) {
          // tap logic: double-tap to zoom, single tap to toggle chrome.
          // Any two real taps of a double-tap naturally land a little apart
          // (finger drift), so the position tolerance is generous — too
          // tight and genuine double-taps get misread as two single taps,
          // each independently turning a page.
          const now = Date.now();
          const pos = { x: endTouch.clientX, y: endTouch.clientY };
          const deltaMs = now - lastTapTime;
          const deltaPx = lastTapPos ? Math.hypot(pos.x - lastTapPos.x, pos.y - lastTapPos.y) : -1;
          const isDouble = now - lastTapTime < 350 &&
            lastTapPos && Math.hypot(pos.x - lastTapPos.x, pos.y - lastTapPos.y) < 70;
          this.debugLog(`tap classify: dtMs=${deltaMs} dPx=${deltaPx.toFixed(0)} isDouble=${isDouble}`);
          if (isDouble) {
            clearTimeout(pendingTapTimer);
            pendingTapTimer = null;
            lastTapTime = 0;
            lastTapPos = null;
            this.debugLog(`-> handleDoubleTap(${pos.x.toFixed(0)},${pos.y.toFixed(0)})`);
            this.handleDoubleTap(pos);
          } else {
            clearTimeout(pendingTapTimer);
            lastTapTime = now;
            lastTapPos = pos;
            pendingTapTimer = setTimeout(() => {
              pendingTapTimer = null;
              this.debugLog(`-> handleSingleTap(${pos.x.toFixed(0)},${pos.y.toFixed(0)}) [after 350ms wait]`);
              this.handleSingleTap(pos);
            }, 350);
          }
        }
        panStart = null;
        wasPinching = false;
        pinchStartMid = null;
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
    this.debugLog(`handleSingleTap relX=${relX.toFixed(2)} scale=${this.scale.toFixed(2)}`);
    if (this.scale <= 1.02) {
      if (relX < 0.25) { this.debugLog("-> prev()"); this.prev(); return; }
      if (relX > 0.75) { this.debugLog("-> next()"); this.next(); return; }
    }
    this.debugLog("-> toggleChrome()");
    this.toggleChrome();
  },

  // Double-tap: if the tap landed inside a detected panel, zoom precisely to
  // that panel's bounds. Otherwise fall back to a geometric zoom centered on
  // the tap point. Either way, a second double-tap while zoomed resets.
  async handleDoubleTap(pos) {
    const stageRect = this.els.stage.getBoundingClientRect();
    if (this.scale > 1.02 || this.bubbleOverlayActive) {
      this.debugLog("handleDoubleTap: already zoomed/overlay active -> resetZoom()");
      this.resetZoom();
      return;
    }

    const img = this.els.viewport.querySelector("img");
    const imgRect = img ? img.getBoundingClientRect() : stageRect;
    const relXImg = clamp((pos.x - imgRect.left) / imgRect.width, 0, 1);
    const relYImg = clamp((pos.y - imgRect.top) / imgRect.height, 0, 1);

    // Bubble Zoom Alt is deliberately checked first: it is the shape-only
    // magnifier, while Panel Zoom is the ordinary page zoom.
    if (this.mode === "single" && this.bubbleAltZoomEnabled) {
      const comicId = this.comic?.id;
      const pageIndex = this.index;
      const url = await this.getPageUrl(pageIndex);
      if (url) {
        const logger = this.debugMode ? (msg) => this.debugLog(`[bubble-alt] ${msg}`) : null;
        const bubble = await BubbleDetect.extract(url, relXImg, relYImg, logger);
        if (!this.comic || this.comic.id !== comicId || this.index !== pageIndex) return;
        if (bubble) {
          this.showBubbleOverlay(bubble, stageRect, imgRect);
          return;
        }
        this.debugLog("bubble-alt: no bubble found -> continuing to panel/fallback zoom");
      }
    }

    const panel = this.mode === "single" ? this.findPanelAt(relXImg, relYImg) : null;
    if (panel) {
      this.debugLog(`-> zoomToPanel ${JSON.stringify(panel)}`);
      this.zoomToPanel(panel, stageRect, imgRect);
      return;
    }

    const targetScale = 2.4;
    this.zoomAtPoint(pos.x, pos.y, targetScale, stageRect);
    this.debugLog(`-> fallback zoom scale=${this.scale.toFixed(2)} tx=${this.tx.toFixed(0)} ty=${this.ty.toFixed(0)}`);
  },

  showBubbleOverlay(bubble, stageRect, imgRect) {
    this.removeBubbleOverlay();
    const canvas = bubble.canvas;
    if (!canvas) return;

    const bubbleW = bubble.w * imgRect.width;
    const bubbleH = bubble.h * imgRect.height;
    if (bubbleW < 8 || bubbleH < 8) return;

    // Magnify the bubble enough to make its lettering comfortably readable,
    // but never beyond the available stage. The original page stays untouched.
    const targetScale = clamp(
      Math.min(stageRect.width / (bubbleW * 1.10), stageRect.height / (bubbleH * 1.10)),
      1.35,
      6
    );

    const centerX = imgRect.left + (bubble.x + bubble.w / 2) * imgRect.width;
    const centerY = imgRect.top + (bubble.y + bubble.h / 2) * imgRect.height;
    const displayW = bubbleW * targetScale;
    const displayH = bubbleH * targetScale;

    const overlay = document.createElement("canvas");
    overlay.className = "bubble-zoom-alt-overlay";
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    overlay.style.width = `${displayW}px`;
    overlay.style.height = `${displayH}px`;
    overlay.style.left = `${centerX - displayW / 2 - stageRect.left}px`;
    overlay.style.top = `${centerY - displayH / 2 - stageRect.top}px`;
    overlay.setAttribute("aria-hidden", "true");
    overlay.getContext("2d").drawImage(canvas, 0, 0);

    this.els.stage.appendChild(overlay);
    this.els.bubbleOverlay = overlay;
    this.bubbleOverlayActive = true;
    this.debugLog(`bubble-alt: overlay ${displayW.toFixed(0)}x${displayH.toFixed(0)} scale=${targetScale.toFixed(2)}`);
  },

  // Zoom around an arbitrary screen-space point, keeping that point fixed
  // relative to the viewport center as the scale changes. This is the same
  // geometry used by the pinch gesture, so double-tap and pinch feel alike.
  zoomAtPoint(screenX, screenY, targetScale, stageRect = this.els.stage.getBoundingClientRect()) {
    const centerX = stageRect.left + stageRect.width / 2;
    const centerY = stageRect.top + stageRect.height / 2;
    const contentX = (screenX - centerX - this.tx) / this.scale;
    const contentY = (screenY - centerY - this.ty) / this.scale;

    this.scale = clamp(targetScale, 1, 5);
    this.tx = screenX - centerX - contentX * this.scale;
    this.ty = screenY - centerY - contentY * this.scale;
    this.constrainPan();
    this.applyTransform();
  },

  // Scales/pans so the given rect (fractional coords within the page image)
  // fills as much of the stage as possible without being cropped. Shared by
  // panel-zoom and bubble-zoom — they differ only in how tightly they fill
  // and how far they're allowed to magnify.
  zoomToRect(rect, stageRect, imgRect, opts = {}) {
    const fillRatio = opts.fillRatio ?? 0.96;
    const maxScale = opts.maxScale ?? 5;

    const rectPxW = rect.w * imgRect.width;
    const rectPxH = rect.h * imgRect.height;
    const sx = stageRect.width / rectPxW;
    const sy = stageRect.height / rectPxH;
    const targetScale = clamp(Math.min(sx, sy) * fillRatio, 1, maxScale);

    const stageCenterX = stageRect.left + stageRect.width / 2;
    const stageCenterY = stageRect.top + stageRect.height / 2;
    const rectCenterX = imgRect.left + (rect.x + rect.w / 2) * imgRect.width;
    const rectCenterY = imgRect.top + (rect.y + rect.h / 2) * imgRect.height;
    const dx = rectCenterX - stageCenterX;
    const dy = rectCenterY - stageCenterY;

    // Transform-origin is the center of the viewport. To move the rect's
    // center onto the stage center after scaling, translation must account
    // for the full scale factor (not scale - 1).
    this.scale = targetScale;
    this.tx = -dx * targetScale;
    this.ty = -dy * targetScale;
    this.constrainPan();
    this.applyTransform();
  },

  zoomToPanel(panel, stageRect, imgRect) {
    this.zoomToRect(panel, stageRect, imgRect, { fillRatio: 0.96, maxScale: 5 });
  },

  // Bubble zoom is allowed to go tighter and further than panel zoom, since
  // the whole point is reading text that's smaller than the panel itself.
  zoomToBubble(bubble, stageRect, imgRect) {
    this.zoomToRect(bubble, stageRect, imgRect, { fillRatio: 0.9, maxScale: 7 });
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
