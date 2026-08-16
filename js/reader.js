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
  panelOverlayActive: false,
  panelOverlayToken: 0,
  focusMode: null,          // null | panel | bubble
  focusAnimationTimer: null,
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
    this.els.bubbleToggle.addEventListener("click", () => this.toggleBubbleZoom());
    this.els.bubbleAltToggle.addEventListener("click", () => this.toggleBubbleAltZoom());
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
    this.resetZoom({ animate: false });
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

  removePanelOverlay(animate = false) {
    this.panelOverlayToken++;
    const overlay = this.els.panelOverlay;
    if (!overlay) {
      this.panelOverlayActive = false;
      if (this.focusMode === "panel") this.focusMode = null;
      return;
    }
    if (animate) {
      // Safe reverse animation: do not reuse or reverse the finished entrance
      // Animation object. Create a fresh animation from the focused state back
      // to the exact original state, then remove the overlay.
      if (overlay._panelZoomInAnimation) {
        try { overlay._panelZoomInAnimation.cancel(); } catch (_) {}
        overlay._panelZoomInAnimation = null;
      }

      const reverseDuration = 680;
      const currentTransform = overlay.style.transform ||
        `translate3d(var(--panel-dx), var(--panel-dy), 0) scale(var(--panel-scale))`;

      this.debugLog(
        `panel-focus: zoom-out START duration=${reverseDuration}ms from=focused`
      );

      const reverse = overlay.animate(
        [
          {
            transform: currentTransform,
            opacity: 1,
            boxShadow: "0 18px 44px rgba(0,0,0,.58)"
          },
          {
            transform: "translate3d(0,0,0) scale(1)",
            opacity: 1,
            boxShadow: "0 5px 16px rgba(0,0,0,.22)"
          }
        ],
        {
          duration: reverseDuration,
          easing: "cubic-bezier(0.22,0.78,0.24,1)",
          fill: "forwards"
        }
      );

      overlay._panelZoomOutAnimation = reverse;

      reverse.onfinish = () => {
        if (!overlay.parentNode) return;
        overlay.style.transform = "translate3d(0,0,0) scale(1)";
        overlay.style.opacity = "1";
        overlay.style.boxShadow = "0 5px 16px rgba(0,0,0,.22)";
        overlay._panelZoomOutAnimation = null;
        overlay.remove();
        this.debugLog("panel-focus: zoom-out COMPLETE");
        this.debugLog("panel-focus: overlay REMOVED");
      };

      reverse.oncancel = () => {
        if (overlay._panelZoomOutAnimation === reverse) {
          overlay._panelZoomOutAnimation = null;
        }
        this.debugLog("panel-focus: zoom-out CANCELLED");
      };
    }
    } else if (overlay.parentNode) {
      overlay.remove();
    }
    this.els.panelOverlay = null;
    this.panelOverlayActive = false;
    if (this.focusMode === "panel") this.focusMode = null;
  },

  removeBubbleOverlay(animate = false) {
    const overlay = this.els.bubbleOverlay;
    if (overlay && animate) {
      overlay.classList.remove("active");
      overlay.classList.add("closing");
      setTimeout(() => {
        if (overlay.parentNode) overlay.remove();
      }, 260);
      this.els.bubbleOverlay = null;
      this.bubbleOverlayActive = false;
      this.focusMode = null;
      this.setFocusDim(false, true);
      return;
    }
    if (overlay) overlay.remove();
    this.els.bubbleOverlay = null;
    this.bubbleOverlayActive = false;
    if (this.focusMode === "bubble") this.focusMode = null;
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

  resetZoom(opts = {}) {
    const animate = opts.animate !== false;
    this.removePanelOverlay(animate);
    this.removeBubbleOverlay();
    this.focusMode = null;
    if (this.focusAnimationTimer) clearTimeout(this.focusAnimationTimer);
    this.focusAnimationTimer = null;
    this.setFocusDim(false, animate);
    if (animate) this.els.viewport.classList.add("reader-focus-transition");
    this.scale = 1; this.tx = 0; this.ty = 0;
    this.applyTransform();
    if (animate) {
      this.focusAnimationTimer = setTimeout(() => {
        this.els.viewport.classList.remove("reader-focus-transition");
        this.focusAnimationTimer = null;
      }, 360);
    } else {
      this.els.viewport.classList.remove("reader-focus-transition");
    }
  },
  setFocusDim(active, animate = true) {
    if (!this.els.stage) return;
    let dim = this.els.focusDim;
    if (!dim) {
      dim = document.createElement("div");
      dim.className = "reader-focus-dim";
      dim.setAttribute("aria-hidden", "true");
      this.els.stage.appendChild(dim);
      this.els.focusDim = dim;
    }
    if (!animate) dim.classList.add("no-transition");
    else dim.classList.remove("no-transition");
    dim.classList.toggle("active", active);
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
    let dragMoved = false;
    let lastTapTime = 0;
    let lastTapPos = null;
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
      // All page navigation is gesture-based. Double-tap is reserved for
      // Bubble Zoom Alt; ordinary double-taps must never trigger page zoom.
      // touch-action:none prevents the browser from stealing the gesture.
      e.preventDefault();
      touches = Array.from(e.touches);
      dragMoved = false;
      this.debugLog(`touchstart n=${touches.length} scale=${this.scale.toFixed(2)}`);
      if (touches.length === 2) {
        if (this.focusMode) {
          this.debugLog(`touchstart: ${this.focusMode} focus active; pinch disabled`);
          dragMoved = true;
          clearTimeout(holdTimer); holdTimer = null;
          return;
        }
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
        if (this.focusMode) { e.preventDefault(); dragMoved = true; return; }
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
          // At page scale, horizontal swipes are the only page-navigation
          // gesture. A tap never turns the page.
          if (panStart) {
            const dx = endTouch.clientX - panStart.x;
            const dy = endTouch.clientY - panStart.y;
            if (!this.focusMode && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.15) {
              this.debugLog(`-> swipe page-turn dx=${dx.toFixed(0)}`);
              if (dx < 0) this.next(); else this.prev();
              panStart = null;
              wasPinching = false;
              return;
            }
          }
        } else {
          this.constrainPan();
        }

        // A stationary tap waits briefly so a second tap can become
        // Bubble Zoom Alt. If no second tap arrives, Panel Zoom gets first
        // choice when the tap lands inside a detected panel; otherwise the
        // tap only toggles the reader chrome.
        if (!dragMoved) {
          const now = Date.now();
          const pos = { x: endTouch.clientX, y: endTouch.clientY };
          const isDouble = lastTapPos &&
            (now - lastTapTime) < 280 &&
            Math.hypot(pos.x - lastTapPos.x, pos.y - lastTapPos.y) < 70;

          if (isDouble) {
            clearTimeout(pendingTapTimer);
            pendingTapTimer = null;
            lastTapTime = 0;
            lastTapPos = null;
            this.debugLog(`-> bubble-only double-tap (${pos.x.toFixed(0)},${pos.y.toFixed(0)})`);
            this.handleDoubleTap(pos);
          } else {
            clearTimeout(pendingTapTimer);
            lastTapTime = now;
            lastTapPos = pos;
            pendingTapTimer = setTimeout(() => {
              pendingTapTimer = null;
              lastTapTime = 0;
              lastTapPos = null;
              this.handleSingleTap(pos);
            }, 280);
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
        // Desktop click mirrors a single tap: it only toggles chrome.
        this.handleSingleTap({ x: e.clientX, y: e.clientY });
      } else if (mouseDown && mouseMoved && this.scale <= 1.02) {
        const dx = e.clientX - mStart.x, dy = e.clientY - mStart.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.15) {
          if (dx < 0) this.next(); else this.prev();
        }
      }
      mouseDown = false;
    });
    // Desktop: double-click while Panel Zoom is active exits the focused panel.
    stage.addEventListener("dblclick", (e) => {
      if (this.mode !== "single") return;
      if (this.focusMode === "panel") {
        e.preventDefault();
        this.debugLog("desktop: double-click -> panel focus reset");
        this.resetZoom({ animate: true });
      }
    });
  },

  async handleSingleTap(pos) {
    // Single tap is Panel Zoom when Panel Zoom is enabled and the tap lands
    // inside a detected panel. A short delay before this method is called
    // gives a second tap the opportunity to become Bubble Zoom Alt instead.
    if (this.mode !== "single" || this.scale > 1.02) return;

    const stageRect = this.els.stage.getBoundingClientRect();
    const img = this.els.viewport.querySelector("img");
    const imgRect = img ? img.getBoundingClientRect() : stageRect;
    if (!imgRect.width || !imgRect.height) {
      this.toggleChrome();
      return;
    }

    const relXImg = clamp((pos.x - imgRect.left) / imgRect.width, 0, 1);
    const relYImg = clamp((pos.y - imgRect.top) / imgRect.height, 0, 1);
    const panel = this.findPanelAt(relXImg, relYImg);

    if (panel) {
      this.debugLog(`-> single-tap panel zoom (${relXImg.toFixed(3)},${relYImg.toFixed(3)})`);
      this.zoomToPanel(panel, stageRect, imgRect);
      return;
    }

    // A tap outside a panel only toggles the reader chrome.
    this.debugLog("-> single tap outside panel: toggle chrome");
    this.toggleChrome();
  },

  // Double-tap is reserved for Bubble Zoom Alt. It has priority over the
  // delayed single-tap Panel Zoom action, so a double-tap inside a bubble
  // will never briefly zoom the surrounding panel first.
  async handleDoubleTap(pos) {
    if (this.mode !== "single") return;

    const stageRect = this.els.stage.getBoundingClientRect();
    if (this.focusMode === "panel") {
      this.debugLog("panel-focus: double-tap -> animated resetZoom()");
      this.resetZoom({ animate: true });
      return;
    }
    if (!this.bubbleAltZoomEnabled) return;
    if (this.bubbleOverlayActive) {
      this.debugLog("bubble-alt: second double-tap -> reset bubble overlay");
      this.removeBubbleOverlay(true);
      return;
    }

    const img = this.els.viewport.querySelector("img");
    const imgRect = img ? img.getBoundingClientRect() : stageRect;
    if (!imgRect.width || !imgRect.height) return;
    const relXImg = clamp((pos.x - imgRect.left) / imgRect.width, 0, 1);
    const relYImg = clamp((pos.y - imgRect.top) / imgRect.height, 0, 1);

    const comicId = this.comic?.id;
    const pageIndex = this.index;
    const url = await this.getPageUrl(pageIndex);
    if (!url) return;
    const logger = this.debugMode ? (msg) => this.debugLog(`[bubble-alt] ${msg}`) : null;
    const bubble = await BubbleDetect.extract(url, relXImg, relYImg, logger);
    if (!this.comic || this.comic.id !== comicId || this.index !== pageIndex) return;

    if (bubble) {
      this.showBubbleOverlay(bubble, stageRect, imgRect);
    } else {
      // A failed bubble double-tap must never fall through to Panel Zoom.
      this.debugLog("bubble-alt: double-tap outside bubble ignored; no panel fallback");
    }
  },

  showBubbleOverlay(bubble, stageRect, imgRect) {
    this.removeBubbleOverlay();
    const canvas = bubble.canvas;
    if (!canvas) return;

    const bubbleW = bubble.w * imgRect.width;
    const bubbleH = bubble.h * imgRect.height;
    if (bubbleW < 8 || bubbleH < 8) return;

    // Bubble Zoom Alt must stay entirely inside the comic page.  The old
    // version centered the enlarged bubble on the detected bubble, which
    // could push balloons near the page edge off-screen and hide lettering.
    const pagePadding = 8;
    const availableW = Math.max(1, imgRect.width - pagePadding * 2);
    const availableH = Math.max(1, imgRect.height - pagePadding * 2);

    // Prefer the usual magnification, but reduce it if the complete bubble
    // cannot fit inside the page. This preserves the whole balloon and text.
    const preferredScale = Math.min(
      stageRect.width / (bubbleW * 1.10),
      stageRect.height / (bubbleH * 1.10)
    );
    const fitScale = Math.min(
      availableW / bubbleW,
      availableH / bubbleH
    );
    const targetScale = clamp(Math.min(preferredScale, fitScale), 1.35, 6);

    const displayW = bubbleW * targetScale;
    const displayH = bubbleH * targetScale;

    // Start from the bubble's natural center, then clamp the enlarged
    // bubble rectangle so every part of it remains inside the comic page.
    const naturalCenterX = imgRect.left + (bubble.x + bubble.w / 2) * imgRect.width;
    const naturalCenterY = imgRect.top + (bubble.y + bubble.h / 2) * imgRect.height;

    const minLeft = imgRect.left + pagePadding;
    const maxLeft = imgRect.right - pagePadding - displayW;
    const minTop = imgRect.top + pagePadding;
    const maxTop = imgRect.bottom - pagePadding - displayH;

    const left = clamp(
      naturalCenterX - displayW / 2,
      minLeft,
      Math.max(minLeft, maxLeft)
    );
    const top = clamp(
      naturalCenterY - displayH / 2,
      minTop,
      Math.max(minTop, maxTop)
    );

    const overlay = document.createElement("canvas");
    overlay.className = "bubble-zoom-alt-overlay";
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    overlay.style.width = `${displayW}px`;
    overlay.style.height = `${displayH}px`;
    overlay.style.left = `${left - stageRect.left}px`;
    overlay.style.top = `${top - stageRect.top}px`;
    overlay.setAttribute("aria-hidden", "true");
    overlay.getContext("2d").drawImage(canvas, 0, 0);

    this.setFocusDim(true, true);
    this.els.stage.appendChild(overlay);
    this.els.bubbleOverlay = overlay;
    this.bubbleOverlayActive = true;
    this.focusMode = "bubble";
    requestAnimationFrame(() => overlay.classList.add("active"));

    const shiftX = left - (naturalCenterX - displayW / 2);
    const shiftY = top - (naturalCenterY - displayH / 2);
    this.debugLog(
      `bubble-alt: overlay ${displayW.toFixed(0)}x${displayH.toFixed(0)} ` +
      `scale=${targetScale.toFixed(2)} ` +
      `containShift=(${shiftX.toFixed(0)},${shiftY.toFixed(0)})`
    );
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
  // becomes the visual focus. Small/medium rects are magnified to a useful
  // reading size. Very large or page-spanning panels instead get a subtle
  // "focus" zoom: enough movement to make the selection feel intentional,
  // without trying to blow an already-large panel off the page.
  zoomToRect(rect, stageRect, imgRect, opts = {}) {
    const fillRatio = opts.fillRatio ?? 0.96;
    const maxScale = opts.maxScale ?? 5;
    const focusKind = opts.focusKind ?? "rect";

    const rectPxW = Math.max(1, rect.w * imgRect.width);
    const rectPxH = Math.max(1, rect.h * imgRect.height);
    const widthRatio = rect.w;
    const heightRatio = rect.h;
    const areaRatio = rect.w * rect.h;

    const sx = stageRect.width / rectPxW;
    const sy = stageRect.height / rectPxH;
    let targetScale = Math.min(sx, sy) * fillRatio;

    if (focusKind === "panel") {
      // A panel that already spans most of the page should not receive a
      // huge mathematical zoom. Give it a small, cinematic focus transition
      // instead, while still centering the selected panel.
      const pageSpanning = widthRatio >= 0.86 || heightRatio >= 0.86 || areaRatio >= 0.68;
      if (pageSpanning) {
        const coverage = Math.max(widthRatio, heightRatio);
        const focusScale = 1.14 - (coverage - 0.68) * 0.24;
        targetScale = clamp(focusScale, 1.035, 1.14);
        this.debugLog(
          `panel-focus: large panel coverage=${coverage.toFixed(3)} area=${areaRatio.toFixed(3)} -> subtle focus scale=${targetScale.toFixed(2)}`
        );
      } else {
        // Leave a little visual breathing room around ordinary panels.
        targetScale *= 0.90;
        targetScale = clamp(targetScale, 1.08, maxScale);
        this.debugLog(
          `panel-focus: standard panel ${widthRatio.toFixed(3)}x${heightRatio.toFixed(3)} -> scale=${targetScale.toFixed(2)}`
        );
      }
    } else {
      targetScale = clamp(targetScale, 1, maxScale);
    }

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

  async zoomToPanel(panel, stageRect, imgRect) {
    if (this.focusMode) return;
    const token = ++this.panelOverlayToken;
    const img = this.els.viewport.querySelector("img");
    if (!img || !img.naturalWidth || !img.naturalHeight) return;

    this.focusMode = "panel";
    this.panelOverlayActive = false;
    this.setFocusDim(true, true);

    const sourceLeft = imgRect.left + panel.x * imgRect.width;
    const sourceTop = imgRect.top + panel.y * imgRect.height;
    const sourceW = Math.max(8, panel.w * imgRect.width);
    const sourceH = Math.max(8, panel.h * imgRect.height);

    // Render the selected frame from the original-resolution page, not the
    // downscaled detector image. Cap the working canvas to keep memory sane
    // on very large scans while retaining more than enough detail for phones.
    const naturalW = Math.max(1, Math.round(panel.w * img.naturalWidth));
    const naturalH = Math.max(1, Math.round(panel.h * img.naturalHeight));
    const renderScale = Math.min(1, 3000 / Math.max(naturalW, naturalH));
    const canvasW = Math.max(1, Math.round(naturalW * renderScale));
    const canvasH = Math.max(1, Math.round(naturalH * renderScale));
    const sx = panel.x * img.naturalWidth;
    const sy = panel.y * img.naturalHeight;
    const sw = panel.w * img.naturalWidth;
    const sh = panel.h * img.naturalHeight;

    const overlay = document.createElement("div");
    overlay.className = "panel-focus-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.left = `${sourceLeft - stageRect.left}px`;
    overlay.style.top = `${sourceTop - stageRect.top}px`;
    overlay.style.width = `${sourceW}px`;
    overlay.style.height = `${sourceH}px`;

    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.getContext("2d").imageSmoothingEnabled = true;
    canvas.getContext("2d").imageSmoothingQuality = "high";
    canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, canvasW, canvasH);
    overlay.appendChild(canvas);

    // Adaptive target: small panels get a useful reading enlargement;
    // page-spanning panels get a subtle focus treatment instead of a huge
    // zoom. The final target is always contained within the comic image.
    const pagePad = Math.max(8, Math.min(18, Math.round(Math.min(imgRect.width, imgRect.height) * 0.018)));
    const availableW = Math.max(1, imgRect.width - pagePad * 2);
    const availableH = Math.max(1, imgRect.height - pagePad * 2);
    const fitScale = Math.min(availableW / sourceW, availableH / sourceH);
    const areaRatio = panel.w * panel.h;
    const coverage = Math.max(panel.w, panel.h);
    const pageSpanning = panel.w >= 0.86 || panel.h >= 0.86 || areaRatio >= 0.68;

    let targetScale;
    if (pageSpanning) {
      targetScale = clamp(Math.min(1.08, fitScale), 1, 1.08);
      this.debugLog(`panel-focus: overlay large coverage=${coverage.toFixed(3)} area=${areaRatio.toFixed(3)} fit=${fitScale.toFixed(2)} target=${targetScale.toFixed(2)}`);
    } else {
      targetScale = clamp(Math.min(fitScale * 0.94, 4.5), 1.08, 4.5);
      this.debugLog(`panel-focus: overlay standard ${panel.w.toFixed(3)}x${panel.h.toFixed(3)} fit=${fitScale.toFixed(2)} target=${targetScale.toFixed(2)}`);
    }

    const targetW = sourceW * targetScale;
    const targetH = sourceH * targetScale;
    const pageLeft = imgRect.left + pagePad;
    const pageTop = imgRect.top + pagePad;
    const pageRight = imgRect.right - pagePad;
    const pageBottom = imgRect.bottom - pagePad;
    const targetCenterX = imgRect.left + imgRect.width / 2;
    const targetCenterY = imgRect.top + imgRect.height / 2;
    const targetLeft = clamp(targetCenterX - targetW / 2, pageLeft, Math.max(pageLeft, pageRight - targetW));
    const targetTop = clamp(targetCenterY - targetH / 2, pageTop, Math.max(pageTop, pageBottom - targetH));
    const dx = targetLeft - sourceLeft;
    const dy = targetTop - sourceTop;

    this.els.stage.appendChild(overlay);
    this.els.panelOverlay = overlay;
    this.panelOverlayActive = true;
    this.els.viewport.classList.add("panel-focus-page-dimmed");

    // The overlay starts exactly over the selected frame and grows/moves to
    // its final focused position. This makes the reader's eye follow the
    // selected frame rather than watching the entire page jump.
    // Use an explicit Web Animations API entrance instead of relying on a
    // CSS transition on a dynamically-created element. This gives us a
    // deterministic start/end state and useful debug instrumentation.
    const startTransform = "translate3d(0,0,0) scale(1)";
    const endTransform = `translate3d(${dx}px, ${dy}px, 0) scale(${targetScale})`;
    const zoomInDuration = 680;

    overlay.style.transition = "none";
    overlay.style.transform = startTransform;
    overlay.style.opacity = "1";
    overlay.style.boxShadow = "0 5px 16px rgba(0,0,0,.22)";
    overlay.style.setProperty("--panel-dx", `${dx}px`);
    overlay.style.setProperty("--panel-dy", `${dy}px`);
    overlay.style.setProperty("--panel-scale", `${targetScale}`);

    requestAnimationFrame(() => {
      if (token !== this.panelOverlayToken || !overlay.parentNode) return;

      this.debugLog(
        `panel-focus: zoom-in START duration=${zoomInDuration}ms from=(0,0,1.00) to=(${dx.toFixed(0)},${dy.toFixed(0)},${targetScale.toFixed(2)})`
      );

      const animation = overlay.animate(
        [
          {
            transform: startTransform,
            opacity: 1,
            boxShadow: "0 5px 16px rgba(0,0,0,.22)"
          },
          {
            transform: endTransform,
            opacity: 1,
            boxShadow: "0 18px 44px rgba(0,0,0,.58)"
          }
        ],
        {
          duration: zoomInDuration,
          easing: "cubic-bezier(0.12,1.24,0.24,1)",
          fill: "forwards"
        }
      );

      overlay._panelZoomInAnimation = animation;

      animation.onfinish = () => {
        if (!overlay.parentNode) return;
        overlay.style.transform = endTransform;
        overlay.style.opacity = "1";
        overlay.style.boxShadow = "0 18px 44px rgba(0,0,0,.58)";
        animation.cancel();
        overlay._panelZoomInAnimation = null;
        this.debugLog("panel-focus: zoom-in COMPLETE");
      };

      animation.oncancel = () => {
        overlay._panelZoomInAnimation = null;
        this.debugLog("panel-focus: zoom-in CANCELLED");
      };
    });

    this.debugLog(`panel-focus: overlay ${sourceW.toFixed(0)}x${sourceH.toFixed(0)} -> ${targetW.toFixed(0)}x${targetH.toFixed(0)} shift=(${dx.toFixed(0)},${dy.toFixed(0)})`);
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
