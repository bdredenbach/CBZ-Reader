// reader.js — the reading experience: paging, zoom/pan, modes, themes

const PANEL_ZOOM_KEY = "longbox_panel_zoom_enabled";
const BUBBLE_ZOOM_KEY = "longbox_bubble_zoom_enabled";
const BUBBLE_ALT_ZOOM_KEY = "longbox_bubble_alt_zoom_enabled";
const HOLD_MS = 500; // long-press duration to trigger bubble zoom

const Reader = {
 comic: null,
 pageUrls: [],       // object URLs, lazily filled
 index: 0,
 mode: "single",      // single | spread | scroll | manga | webcomic
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
   this.els.debugPanel = document.getElementById("debug-panel");
   this.els.helpDrawer = document.getElementById("help-drawer");
   this.nativePageTurn = new LongboxNativePageTurn(this);

   // v59.23: real Turn.js takeover for Page mode.
   this.turnPageMode = new LongboxPageMode({
     getIssue: () => this.comic,
     getPageUrl: (i) => this.getPageUrl(i),
     getIndex: () => this.index,
     setIndex: (i) => {
       this.index = Math.max(0, Math.min(this.comic.pageCount - 1, i));
       this.updateSliderLabel();
       this.updateBookmarkFlag();
       this.saveProgress();
     },
     onPageChanged: (i) => {
       this.index = Math.max(0, Math.min(this.comic.pageCount - 1, i));
       this.updateSliderLabel();
       this.updateBookmarkFlag();
       this.saveProgress();
       this.loadPanelsForCurrentPage();
     },
     onState: (s) => this.debugLog(`Turn.js: ${s}`)
   });
   this.useTurnJSPageMode = true;

   document.getElementById("reader-back").addEventListener("click", () => this.close());
   document.getElementById("reader-bookmark").addEventListener("click", () => this.toggleBookmark());
   document.getElementById("reader-help").addEventListener("click", () => this.openHelpDrawer());
   document.getElementById("help-drawer-close").addEventListener("click", () => this.closeHelpDrawer());
   this.els.helpDrawer.addEventListener("click", (e) => {
     if (e.target === this.els.helpDrawer) this.closeHelpDrawer();
   });
   this.els.bubbleToggle.addEventListener("click", () => this.toggleBubbleAltZoom());
   this.updateBubbleToggleUI();
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

   let spreadTimer = null;
   const settleSpread = () => {
     if (this.mode !== "spread") return;
     clearTimeout(spreadTimer);
     spreadTimer = setTimeout(() => this.stabilizeSpreadLayout(), 500);
   };
   window.addEventListener("resize", settleSpread, { passive: true });
   window.addEventListener("orientationchange", settleSpread, { passive: true });
   if (window.visualViewport) {
     window.visualViewport.addEventListener("resize", settleSpread, { passive: true });
   }
   screen.orientation?.addEventListener?.("change", settleSpread);

   let continuousTimer = null;
   const settleContinuous = () => {
     if (!(this.mode === "scroll" || this.mode === "manga" || this.mode === "webcomic")) return;
     clearTimeout(continuousTimer);
     continuousTimer = setTimeout(async () => {
       await this.stabilizeContinuousLayout();
       if (this.mode === "scroll" || this.mode === "manga") {
         const h = this.els.stage.clientHeight;
         if (h > 0) {
           this.els.viewport.style.height = `${h}px`;
           this.els.stage.querySelectorAll(".scroll-page").forEach(wrap => {
             wrap.style.height = `${h}px`;
           });
         }
       }
     }, 100);
   };
   window.addEventListener("resize", settleContinuous, { passive: true });
   window.addEventListener("orientationchange", settleContinuous, { passive: true });
   if (window.visualViewport) {
     window.visualViewport.addEventListener("resize", settleContinuous, { passive: true });
   }
   screen.orientation?.addEventListener?.("change", settleContinuous);
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
   if (this.mode === "scroll" || this.mode === "manga" || this.mode === "webcomic") {
     await this.renderContinuous();
   } else {
     await this.renderPaged();
   }
   this.updateSliderLabel();
   this.updateBookmarkFlag();
   this.saveProgress();
 },

 async renderPaged() {
    if (this.mode === "single" && this.useTurnJSPageMode && this.turnPageMode) {
      const ok = await this.turnPageMode.render(this.els.viewport);
      if (ok) {
        this.prefetch();
        this.loadPanelsForCurrentPage();
        this.updateSliderLabel();
        this.updateBookmarkFlag();
        return;
      }
      this.debugLog("Turn.js Page Mode unavailable; using normal page renderer.");
    }

   // Restore the shared viewport's paged layout explicitly. Continuous
   // modes use max-content/scroll geometry; those styles must not leak into
   // Spread Mode after a mode switch.
   this.els.viewport.style.display = "flex";
   this.els.viewport.style.width = "100%";
   this.els.viewport.style.height = "100%";
   this.els.viewport.style.transform = "none";
   this.els.viewport.scrollLeft = 0;
   this.els.viewport.scrollTop = 0;
   this.els.stage.scrollLeft = 0;
   this.els.stage.scrollTop = 0;

   const indices = this.mode === "spread"
     ? [this.index, this.index + 1].filter(i => i < this.comic.pageCount)
     : [this.index];

   this.els.viewport.innerHTML = "";
   const urls = await Promise.all(indices.map(i => this.getPageUrl(i)));
   const imgs = [];

   for (const url of urls) {
     if (!url) continue;
     const img = document.createElement("img");
     img.src = url;
     img.draggable = false;
     this.els.viewport.appendChild(img);
     imgs.push(img);
   }

   this.prefetch();
   this.loadPanelsForCurrentPage();
 },

 async stabilizeContinuousLayout() {
   if (!(this.mode === "scroll" || this.mode === "manga" || this.mode === "webcomic")) return;

   await new Promise(resolve => {
     let frames = 3;
     const tick = () => {
       if (--frames <= 0) resolve();
       else requestAnimationFrame(tick);
     };
     requestAnimationFrame(tick);
   });

   if (!(this.mode === "scroll" || this.mode === "manga" || this.mode === "webcomic")) return;

   const stage = this.els.stage;
   const viewport = this.els.viewport;
   const width = stage.clientWidth;
   const height = stage.clientHeight;

   if (width > 0 && height > 0) {
     viewport.style.height = `${height}px`;
     if (this.mode === "webcomic") {
       viewport.style.width = `${width}px`;
     }
   }

   this.debugLog(`continuous layout settled: ${this.mode} ${width}x${height}`);
 },

 async loadContinuousPage(i) {
   if (i < 0 || i >= this.comic.pageCount) return;
   const wrap = this.els.stage.querySelector(`.scroll-page[data-index="${i}"]`);
   if (!wrap) return;
   const img = wrap.querySelector("img");
   if (!img || img.dataset.src !== "pending") return;

   img.dataset.src = "loading";
   const url = await this.getPageUrl(i);
   if (!url) {
     img.dataset.src = "pending";
     return;
   }
   img.src = url;
   if (img.decode) await img.decode().catch(() => {});
 },

 async renderContinuous() {
   await this.stabilizeContinuousLayout();
   const horizontal = this.mode === "scroll" || this.mode === "manga";
   const rtl = this.mode === "manga";
   this.els.stage.classList.toggle("mode-scroll", this.mode === "scroll");
   this.els.stage.classList.toggle("mode-manga", rtl);
   this.els.stage.classList.toggle("mode-webcomic", this.mode === "webcomic");
   this.els.viewport.innerHTML = "";
   this.els.viewport.style.transform = "";

   const frag = document.createDocumentFragment();
   if (this.comic.pageCount) {
     Array.from({ length: this.comic.pageCount }).forEach((_, i) => {
       const wrap = document.createElement("div");
       wrap.className = "scroll-page";
       wrap.dataset.index = i;
       const img = document.createElement("img");
       img.dataset.src = "pending";
       wrap.appendChild(img);
       frag.appendChild(wrap);
     });
   }
   this.els.viewport.appendChild(frag);

   if (horizontal) {
     const pageHeight = this.els.stage.clientHeight;
     if (pageHeight > 0) {
       this.els.viewport.style.height = `${pageHeight}px`;
       this.els.stage.querySelectorAll(".scroll-page").forEach(wrap => {
         wrap.style.height = `${pageHeight}px`;
       });
     }
   }

   const currentWrap = this.els.stage.querySelector(
     `.scroll-page[data-index="${this.index}"]`
   );
   if (currentWrap) {
     await this.loadContinuousPage(this.index);

     // Keep a symmetric real-page window around the current page. Pending
     // wrappers have zero width; loading only forward makes a re-entered
     // Scroll/Manga reader unable to move backward because the pages behind
     // the current index contribute no scrollable geometry.
     const lookBehind = horizontal ? 3 : 1;
     const lookAhead = horizontal ? 3 : 1;
     for (let n = 1; n <= lookBehind; n++) {
       this.loadContinuousPage(this.index - n);
     }
     for (let n = 1; n <= lookAhead; n++) {
       this.loadContinuousPage(this.index + n);
     }
   }

   const io = new IntersectionObserver((entries) => {
     entries.forEach(async (entry) => {
       const wrap = entry.target;
       const i = parseInt(wrap.dataset.index, 10);
       if (entry.isIntersecting) {
         await this.loadContinuousPage(i);

         // Extend the real scrollable track in BOTH directions. This is
         // especially important after re-entering Scroll/Manga at a later
         // page, where the previous wrappers may still be zero-width.
         const lookBehind = horizontal ? 3 : 1;
         const lookAhead = horizontal ? 3 : 1;
         for (let n = 1; n <= lookBehind; n++) {
           this.loadContinuousPage(i - n);
         }
         for (let n = 1; n <= lookAhead; n++) {
           this.loadContinuousPage(i + n);
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

   if (horizontal) {
     const settledHeight = this.els.stage.clientHeight;
     if (settledHeight > 0) {
       this.els.viewport.style.height = `${settledHeight}px`;
       this.els.stage.querySelectorAll(".scroll-page").forEach(wrap => {
         wrap.style.height = `${settledHeight}px`;
       });
     }
   }

   requestAnimationFrame(() => {
     const target = this.els.stage.querySelector(`.scroll-page[data-index="${this.index}"]`);
     if (target) {
       target.scrollIntoView({
         block: "start",
         inline: horizontal ? "nearest" : "nearest"
       });
     }
   });
 },

 prefetch() {
   const step = this.mode === "spread" ? 2 : 1;
   [this.index + step, this.index - 1].forEach((i) => this.getPageUrl(i));
 },

 async loadPanelsForCurrentPage() {
   this.currentPanels = [];
   if (this.mode !== "single") return;

   const comicId = this.comic.id;
   const pageIndex = this.index;
   const token = ++this._panelLoadToken;
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

   if (token !== this._panelLoadToken || this.comic.id !== comicId || this.index !== pageIndex) return;
   this.currentPanels = panels;
   if (logger) logger(`currentPanels set: ${panels.length}`);
 },

 getPanelImageContext() {
   // Turn.js keeps multiple page images in the viewport. Resolve the image
   // belonging to the page Turn.js says is currently visible.
   if (this.mode === "single" &&
       this.useTurnJSPageMode &&
       this.turnPageMode?.book) {
     try {
       const book = this.turnPageMode.book;
       const view = book.turn("view");
       const pageNumber = Array.isArray(view) ? Number(view[0]) : Number(view);
       const data = book.data();
       const pageObj = data?.pageObjs?.[pageNumber];
       const img = pageObj?.find?.("img")?.get?.(0);
       if (img) {
         const rect = img.getBoundingClientRect();
         if (rect.width > 1 && rect.height > 1) {
           return { img, rect, pageNumber };
         }
       }
     } catch (_) {}
   }
   const img = this.els.viewport.querySelector("img");
   const rect = img?.getBoundingClientRect();
   if (img && rect && rect.width > 1 && rect.height > 1) {
     return { img, rect, pageNumber: this.index + 1 };
   }
   return null;
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
   if (this.els.panelToggle) {
     this.els.panelToggle.classList.toggle("active", this.panelZoomEnabled);
   }
 },

 toggleBubbleZoom() {
   this.bubbleZoomEnabled = !this.bubbleZoomEnabled;
   localStorage.setItem(BUBBLE_ZOOM_KEY, this.bubbleZoomEnabled ? "1" : "0");
   this.updateBubbleToggleUI();
 },
 updateBubbleToggleUI() {
   if (this.els.bubbleToggle) {
     this.els.bubbleToggle.classList.toggle("active", this.bubbleAltZoomEnabled);
   }
 },

 toggleBubbleAltZoom() {
   this.bubbleAltZoomEnabled = !this.bubbleAltZoomEnabled;
   localStorage.setItem(BUBBLE_ALT_ZOOM_KEY, this.bubbleAltZoomEnabled ? "1" : "0");
   this.updateBubbleToggleUI();
 },

 removePanelOverlay(animate = false) {
   this.panelOverlayToken++;
   const overlay = this.els.panelOverlay;
   if (!overlay) {
     this.panelFocusMeta = null;
     this.panelOverlayActive = false;
     if (this.focusMode === "panel") this.focusMode = null;
     return;
   }
   if (animate) {
     if (overlay._panelZoomOutAnimation) {
       try { overlay._panelZoomOutAnimation.cancel(); } catch (_) {}
       overlay._panelZoomOutAnimation = null;
     }

     if (overlay._panelZoomInAnimation) {
       try { overlay._panelZoomInAnimation.cancel(); } catch (_) {}
       overlay._panelZoomInAnimation = null;
     }

     const reverseDuration = 680;
     const focusedTransform = overlay.style.transform ||
       `translate3d(var(--panel-dx), var(--panel-dy), 0) scale(var(--panel-scale))`;

     this.debugLog(`panel-focus: zoom-out START duration=${reverseDuration}ms`);

     const reverse = overlay.animate(
       [
         {
           transform: focusedTransform,
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
   this.els.stage.classList.toggle("mode-scroll", this.mode === "scroll" || this.mode === "webcomic");
   this.els.stage.classList.toggle("mode-manga", this.mode === "manga");
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

 async stabilizeSpreadLayout() {
   if (this.mode !== "spread") return;

   await new Promise(resolve => {
     let frames = 4;
     const tick = () => {
       if (--frames <= 0) resolve();
       else requestAnimationFrame(tick);
     };
     requestAnimationFrame(tick);
   });

   if (this.mode !== "spread") return;
   const width = this.els.stage.clientWidth;
   const height = this.els.stage.clientHeight;
   if (width > 0 && height > 0) {
     this.els.viewport.style.display = "flex";
     this.els.viewport.style.width = `${width}px`;
     this.els.viewport.style.height = `${height}px`;
     this.els.viewport.style.transform = "none";
     this.els.viewport.style.alignItems = "center";
     this.els.viewport.style.justifyContent = "center";
   }
   this.els.stage.scrollLeft = 0;
   this.els.stage.scrollTop = 0;
   this.debugLog(`spread layout settled: ${width}x${height}`);
 },

 async setMode(mode) {
   if (mode === this.mode) return;
   this.debugLog(`setMode: ${this.mode} -> ${mode}`);
   if (this._scrollObserver) { this._scrollObserver.disconnect(); this._scrollObserver = null; }

   const wasSpread = this.mode === "spread";

   if (this.mode === "single" && mode !== "single" && this.turnPageMode) {
     await this.turnPageMode.destroy();
     // Turn.js hides its shared host on destroy; other modes need it visible.
     this.els.viewport.style.display = "";
   }

   this.mode = mode;
   this.comic.readMode = mode;
   LongboxDB.updateComic(this.comic.id, { readMode: mode });
   this.applyModeClass();
   this.updateModePills();

   if (mode === "spread") {
     let orientationLocked = false;

     if (screen.orientation?.lock) {
       try {
         await screen.orientation.lock("landscape-primary");
         orientationLocked = true;
         this.debugLog("spread: landscape-primary orientation locked");
       } catch (err) {
         try {
           await screen.orientation.lock("landscape");
           orientationLocked = true;
           this.debugLog("spread: landscape orientation locked");
         } catch (err2) {
           this.debugLog("spread: normal orientation lock unavailable");
         }
       }
     }

     if (!orientationLocked && !document.fullscreenElement && this.els.view?.requestFullscreen) {
       try {
         await this.els.view.requestFullscreen({ navigationUI: "hide" });
         this.debugLog("spread: entered fullscreen for orientation lock");
         if (screen.orientation?.lock) {
           try {
             await screen.orientation.lock("landscape-primary");
             orientationLocked = true;
             this.debugLog("spread: landscape-primary locked after fullscreen");
           } catch (err3) {
             try {
               await screen.orientation.lock("landscape");
               orientationLocked = true;
               this.debugLog("spread: landscape locked after fullscreen");
             } catch (err4) {}
           }
         }
       } catch (fullscreenErr) {
         this.debugLog("spread: fullscreen fallback unavailable");
       }
     }

     if (!orientationLocked) {
       this.debugLog("spread: landscape lock unavailable; current orientation retained");
     }
   } else if (wasSpread) {
     if (screen.orientation?.unlock) {
       try { screen.orientation.unlock(); } catch (_) {}
     }
     if (document.fullscreenElement && document.exitFullscreen) {
       try { await document.exitFullscreen(); } catch (_) {}
     }
   }

   await this.render();
   if (this.mode === "spread") {
     await this.stabilizeSpreadLayout();
     await new Promise(resolve => requestAnimationFrame(resolve));
     this.debugLog(`spread final layout: ${this.els.stage.clientWidth}x${this.els.stage.clientHeight}`);
   }
   this.showChrome();
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
   i = Math.max(0, Math.min(this.comic.pageCount - 1, i));
   if (this.mode === "single" && this.useTurnJSPageMode && this.turnPageMode?.book) {
     if (i === this.index && !opts.fromSlider) return;
     this.turnPageMode.goTo(i);
     return;
   }

   if (i === this.index && !opts.fromSlider) return;
   this.index = i;
   if (this.mode === "scroll" || this.mode === "webcomic" || this.mode === "manga") {
     const target = this.els.stage.querySelector(`.scroll-page[data-index="${i}"]`);
     if (target) target.scrollIntoView({ block: "start", behavior: opts.fromSlider ? "auto" : "smooth" });
     this.updateSliderLabel();
     this.updateBookmarkFlag();
     this.saveProgress();
   } else {
     this.render();
   }
 },
  clearPanelFocusForNavigation() {
    if (this.focusMode === "panel" || this.panelOverlayActive) {
      this.resetZoom({ animate: false });
    }
  },


 next() {


   this._deferredPanelTap = null;


   this.clearPanelFocusForNavigation();
   this.showChrome();
   if (this.mode === "single" && this.useTurnJSPageMode && this.turnPageMode?.book && this.scale <= 1.02) {
     this.turnPageMode.next();
     return;
   }

   if (this.mode === "single" && this.scale <= 1.02 && this.nativePageTurn) {
     this.nativePageTurn.turn("next").then(handled => {
       if (!handled && !this.nativePageTurn.running) this.goTo(this.index + 1);
     });
     return;
   }
   const step = this.mode === "spread" ? 2 : 1;
   this.goTo(this.index + step);
 },

 prev() {

   this._deferredPanelTap = null;

   this.clearPanelFocusForNavigation();
   this.showChrome();
   if (this.mode === "single" && this.useTurnJSPageMode && this.turnPageMode?.book && this.scale <= 1.02) {
     this.turnPageMode.prev();
     return;
   }

   if (this.mode === "single" && this.scale <= 1.02 && this.nativePageTurn) {
     this.nativePageTurn.turn("prev").then(handled => {
       if (!handled && !this.nativePageTurn.running) this.goTo(this.index - 1);
     });
     return;
   }
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
     this.chromeTimer = setTimeout(() => { this.debugLog("auto-hideChrome (1.0s timer)"); this.hideChrome(); }, 1000);
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
   this.panelFocusMeta = null;
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

 constrainPan() {
   // Utility bounds computation for scale translations
   if (this.scale <= 1) {
     this.tx = 0;
     this.ty = 0;
     return;
   }
   const stageRect = this.els.stage.getBoundingClientRect();
   const maxTx = (stageRect.width * (this.scale - 1)) / 2;
   const maxTy = (stageRect.height * (this.scale - 1)) / 2;
   this.tx = clamp(this.tx, -maxTx, maxTx);
   this.ty = clamp(this.ty, -maxTy, maxTy);
 },

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
   let continuousTapStart = null;
   let continuousHoldTimer = null;
   let continuousHoldFired = false;
   let dragMoved = false;
   let lastTapTime = 0;
   let lastTapPos = null;
   let pendingTapTimer = null;
   let holdTimer = null;
   let holdFired = false;

   const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
   const mid = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

   const getContinuousTargetAtPoint = (screenX, screenY) => {
     if (!(this.mode === "scroll" || this.mode === "webcomic" || this.mode === "manga")) return null;
     const pages = Array.from(this.els.stage.querySelectorAll(".scroll-page"));
     for (const page of pages) {
       const img = page.querySelector("img");
       if (!img) continue;
       const rect = img.getBoundingClientRect();
       if (rect.width < 2 || rect.height < 2) continue;
       if (screenX >= rect.left && screenX <= rect.right &&
           screenY >= rect.top && screenY <= rect.bottom) {
         const pageIndex = Number(page.dataset.index);
         if (!Number.isInteger(pageIndex)) continue;
         return { page, img, imgRect: rect, pageIndex };
       }
     }
     return null;
   };

   const triggerContinuousHold = async (screenX, screenY) => {
     continuousHoldFired = true;
     continuousTapStart = null;

     if (!this.bubbleZoomEnabled) return;
     if (this.bubbleOverlayActive) {
       this.removeBubbleOverlay(true);
       return;
     }

     const target = getContinuousTargetAtPoint(screenX, screenY);
     if (!target) return;

     const stageRect = this.els.stage.getBoundingClientRect();
     const relXImg = clamp((screenX - target.imgRect.left) / target.imgRect.width, 0, 1);
     const relYImg = clamp((screenY - target.imgRect.top) / target.imgRect.height, 0, 1);
     const comicId = this.comic?.id;
     const pageIndex = target.pageIndex;

     const url = await this.getPageUrl(pageIndex);
     if (!url) return;

     const logger = this.debugMode
       ? (msg) => this.debugLog(`[bubble-continuous] ${msg}`)
       : null;
     const bubble = await BubbleDetect.detect(url, relXImg, relYImg, logger);

     if (!this.comic || this.comic.id !== comicId) return;

     const fresh = getContinuousTargetAtPoint(screenX, screenY);
     const displayTarget = fresh && fresh.pageIndex === pageIndex ? fresh : target;

     if (bubble) {
       this.showBubbleOverlay(bubble, stageRect, displayTarget.imgRect, displayTarget.page);
     }
   };

   const handleContinuousDoubleTap = async (screenX, screenY) => {
     if (!this.bubbleAltZoomEnabled) return;
     if (this.bubbleOverlayActive) {
       this.removeBubbleOverlay(true);
       return;
     }

     const target = getContinuousTargetAtPoint(screenX, screenY);
     if (!target) return;

     const stageRect = this.els.stage.getBoundingClientRect();
     const relXImg = clamp((screenX - target.imgRect.left) / target.imgRect.width, 0, 1);
     const relYImg = clamp((screenY - target.imgRect.top) / target.imgRect.height, 0, 1);
     const comicId = this.comic?.id;
     const pageIndex = target.pageIndex;

     const url = await this.getPageUrl(pageIndex);
     if (!url) return;

     const logger = this.debugMode
       ? (msg) => this.debugLog(`[bubble-alt-continuous] ${msg}`)
       : null;
     const bubble = await BubbleDetect.extract(url, relXImg, relYImg, logger);

     if (!this.comic || this.comic.id !== comicId) return;

     const fresh = getContinuousTargetAtPoint(screenX, screenY);
     const displayTarget = fresh && fresh.pageIndex === pageIndex ? fresh : target;

     if (bubble) {
       this.showBubbleOverlay(bubble, stageRect, displayTarget.imgRect, displayTarget.page);
     }
   };

   const triggerHold = async (screenX, screenY) => {
     holdFired = true;
     dragMoved = true;
     panStart = null;

     if (!this.bubbleZoomEnabled || this.mode !== "single") return;

     if (this.scale > 1.02) {
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

     if (!this.comic || this.comic.id !== comicId || this.index !== pageIndex) return;

     if (bubble) {
       this.zoomToBubble(bubble, stageRect, imgRect);
     } else {
       this.zoomAtPoint(screenX, screenY, 2.4, stageRect);
     }
   };

   stage.addEventListener("touchstart", (e) => {
     if (this.mode === "scroll" || this.mode === "webcomic" || this.mode === "manga") {
       if (e.touches.length === 1) {
         const t = e.touches[0];
         continuousTapStart = { x: t.clientX, y: t.clientY };
         continuousHoldFired = false;
         clearTimeout(continuousHoldTimer);
         continuousHoldTimer = setTimeout(
           () => triggerContinuousHold(t.clientX, t.clientY),
           HOLD_MS
         );
       } else {
         continuousTapStart = null;
         continuousHoldFired = false;
         clearTimeout(continuousHoldTimer);
         continuousHoldTimer = null;
       }
       return;
     }
     e.preventDefault();
     touches = Array.from(e.touches);
     dragMoved = false;
     if (touches.length === 2) {
       if (this.focusMode) {
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
     if (this.mode === "scroll" || this.mode === "webcomic" || this.mode === "manga") {
       if (continuousTapStart && e.touches.length === 1) {
         const dx = e.touches[0].clientX - continuousTapStart.x;
         const dy = e.touches[0].clientY - continuousTapStart.y;
         if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
           continuousTapStart = null;
           clearTimeout(continuousHoldTimer);
           continuousHoldTimer = null;
         }
       } else if (e.touches.length !== 1) {
         continuousTapStart = null;
         clearTimeout(continuousHoldTimer);
         continuousHoldTimer = null;
       }
       return;
     }
     touches = Array.from(e.touches);
     if (touches.length === 2) {
       if (this.focusMode) { e.preventDefault(); dragMoved = true; return; }
       e.preventDefault();
       const d = Math.max(1, dist(touches[0], touches[1]));
       const currentMid = mid(touches[0], touches[1]);
       const newScale = clamp(pinchStartScale * (d / pinchStartDist), 1, 5);

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
           dragMoved = true;
           clearTimeout(holdTimer);
           holdTimer = null;
         }
       } else if (Math.abs(dx) > 10) {
         dragMoved = true;
         clearTimeout(holdTimer);
         holdTimer = null;
       }
     }
   }, { passive: false });

   stage.addEventListener("touchend", (e) => {
     if (this.mode === "scroll" || this.mode === "webcomic" || this.mode === "manga") {
       clearTimeout(continuousHoldTimer);
       continuousHoldTimer = null;
       const t = e.changedTouches[0];
       const isStationary = !!(t && continuousTapStart &&
         Math.abs(t.clientX - continuousTapStart.x) <= 10 &&
         Math.abs(t.clientY - continuousTapStart.y) <= 10);

       if (isStationary && !continuousHoldFired) {
         const now = Date.now();
         const pos = { x: t.clientX, y: t.clientY };
         const isDouble = lastTapPos &&
           (now - lastTapTime) < 280 &&
           Math.hypot(pos.x - lastTapPos.x, pos.y - lastTapPos.y) < 70;

         if (isDouble) {
           clearTimeout(pendingTapTimer);
           pendingTapTimer = null;
           lastTapTime = 0;
           lastTapPos = null;
           handleContinuousDoubleTap(pos.x, pos.y);
         } else {
           clearTimeout(pendingTapTimer);
           lastTapTime = now;
           lastTapPos = pos;
           pendingTapTimer = setTimeout(() => {
             pendingTapTimer = null;
             lastTapTime = 0;
             lastTapPos = null;
             this.showChrome();
           }, 280);
         }
       }

       continuousTapStart = null;
       continuousHoldFired = false;
       return;
     }
     e.preventDefault();
     clearTimeout(holdTimer);
     holdTimer = null;
     const remaining = e.touches.length;
     const endTouch = e.changedTouches[0];

     if (remaining === 0 && holdFired) {
       holdFired = false;
       wasPinching = false;
       panStart = null;
       return;
     }

     if (remaining === 1 && wasPinching) {
       const t = e.touches[0];
       panStart = { x: t.clientX, y: t.clientY, tx: this.tx, ty: this.ty };
       wasPinching = false;
       dragMoved = true;
       return;
     }

     if (remaining === 0) {
       if (this.scale <= 1.02) {
         this.scale = 1;
         this.constrainPan();
         if (panStart) {
           const dx = endTouch.clientX - panStart.x;
           const dy = endTouch.clientY - panStart.y;
           if (!this.focusMode && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.15) {
             if (this.focusMode === "panel") this.clearPanelFocusForNavigation();
             if (dx < 0) this.next(); else this.prev();
             panStart = null;
             wasPinching = false;
             return;
           }
         }
       } else {
         this.constrainPan();
       }

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
           this.handleDoubleTap(pos);
         } else {
           let panelHit = false;
           if (this.mode === "single" && this.panelZoomEnabled) {
             const ctx = this.getPanelImageContext();
             if (ctx) {
               const relX = clamp((pos.x - ctx.rect.left) / ctx.rect.width, 0, 1);
               const relY = clamp((pos.y - ctx.rect.top) / ctx.rect.height, 0, 1);
               panelHit = !!this.findPanelAt(relX, relY);
             }
           }

           if (panelHit) {
             clearTimeout(pendingTapTimer);
             pendingTapTimer = null;
             lastTapTime = now;
             lastTapPos = pos;

             // Once a frame is already focused, do NOT create another
             // deferred panel candidate. The next tap belongs to the
             // focused-frame interaction: bubble detection gets a chance,
             // and if no bubble is found the frame is dismissed.
             if (this.focusMode === "panel") {
               this._deferredPanelTap = null;
               return;
             }

             // Unfocused panel: defer commitment so a direct bubble
             // double-tap can win before the frame opens.
             const panelCtx = this.getPanelImageContext();
             const panelImgRect = panelCtx?.rect;
             const comicId = this.comic?.id;
             const pageIndex = this.index;

             if (this.bubbleAltZoomEnabled && panelCtx && panelImgRect) {
               const relX = clamp(
                 (pos.x - panelImgRect.left) / panelImgRect.width, 0, 1
               );
               const relY = clamp(
                 (pos.y - panelImgRect.top) / panelImgRect.height, 0, 1
               );

               this._deferredPanelTap = {
                 pos,
                 comicId,
                 pageIndex,
                 promise: (async () => {
                   try {
                     const url = await this.getPageUrl(pageIndex);
                     if (!url) return { bubble: null };

                     const logger = this.debugMode
                       ? (msg) => this.debugLog(`[bubble-deferred] ${msg}`)
                       : null;

                     const bubble = await BubbleDetect.extract(
                       url, relX, relY, logger
                     );

                     return {
                       bubble,
                       imgRect: panelImgRect
                     };
                   } catch (_) {
                     return { bubble: null };
                   }
                 })()
               };
             } else {
               this._deferredPanelTap = null;
             }

             pendingTapTimer = setTimeout(() => {
               pendingTapTimer = null;
               lastTapTime = 0;
               lastTapPos = null;
               this._deferredPanelTap = null;
               this.handleSingleTap(pos);
             }, 450);
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
       }
       panStart = null;
       wasPinching = false;
       pinchStartMid = null;
     }
   });

   stage.addEventListener("wheel", (e) => {
     if (this.mode === "scroll" || this.mode === "webcomic" || this.mode === "manga") return;
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
     if (!mouseDown || this.mode === "scroll" || this.mode === "webcomic" || this.mode === "manga") return;
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
       const dx = e.clientX - mStart.x, dy = e.clientY - mStart.y;
       if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.15) {
         if (dx < 0) this.next(); else this.prev();
       }
     }
     mouseDown = false;
   });
   stage.addEventListener("dblclick", (e) => {
     if (this.mode !== "single") return;
     if (this.focusMode === "panel") {
       e.preventDefault();
       this.resetZoom({ animate: true });
     }
   });
 },

 async handleSingleTap(pos) {
   if (this.mode !== "single" || this.scale > 1.02) return;

   const stageRect = this.els.stage.getBoundingClientRect();
   const ctx = this.getPanelImageContext();
   const img = ctx?.img;
   const imgRect = ctx?.rect || stageRect;
   if (!img || !imgRect.width || !imgRect.height) {
     this.toggleChrome();
     return;
   }

   const relXImg = clamp((pos.x - imgRect.left) / imgRect.width, 0, 1);
   const relYImg = clamp((pos.y - imgRect.top) / imgRect.height, 0, 1);
   const panel = this.findPanelAt(relXImg, relYImg);

   if (panel) {
     this.zoomToPanel(panel, stageRect, imgRect);
     return;
   }

   this.toggleChrome();
 },

 async handleDeferredPanelDoubleTap(pos) {
   const pending = this._deferredPanelTap;
   if (!pending) return false;

   this._deferredPanelTap = null;

   try {
     const result = await pending.promise;
     if (!result || !result.bubble) {
       // No bubble: because this was a genuine double tap on an already
       // focused frame, dismiss the frame instead of sending the tap back
       // through handleSingleTap() (which would hit the same focused panel).
       if (this.focusMode === "panel") {
         this.resetZoom({ animate: true });
       } else {
         this.handleSingleTap(pending.pos);
       }
       return true;
     }

     if (this.comic?.id !== pending.comicId ||
         this.index !== pending.pageIndex) return true;

     const stageRect = this.els.stage.getBoundingClientRect();
     this.showBubbleOverlay(
       result.bubble,
       stageRect,
       result.imgRect
     );
     return true;
   } catch (_) {
     // If detection fails, preserve the normal frame interaction.
     this.handleSingleTap(pending.pos);
     return true;
   }
 },

 async handleDoubleTap(pos) {
   if (this.mode !== "single") return;

   // An active bubble owns the next double-tap. Do this BEFORE checking any
   // deferred panel tap, otherwise the bubble can become impossible to close.
   if (this.bubbleOverlayActive) {
     this._deferredPanelTap = null;
     this.removeBubbleOverlay(true);
     return;
   }

   if (this._deferredPanelTap) {
     const handled = await this.handleDeferredPanelDoubleTap(pos);
     if (handled) return;
   }

   const stageRect = this.els.stage.getBoundingClientRect();

   if (!this.bubbleAltZoomEnabled) {
     if (this.focusMode === "panel") this.resetZoom({ animate: true });
     return;
   }

   if (this.bubbleOverlayActive) {
     this.removeBubbleOverlay(true);
     return;
   }

   const comicId = this.comic?.id;
   const pageIndex = this.index;
   const url = await this.getPageUrl(pageIndex);
   if (!url) return;

   const logger = this.debugMode
     ? (msg) => this.debugLog(`[bubble-alt] ${msg}`)
     : null;

   // IMPORTANT: when a panel is already popped out, the tap is landing on
   // the enlarged panel overlay. Map that screen coordinate back through the
   // panel crop to the original comic page before running BubbleDetect.
   if (this.focusMode === "panel" &&
       this.panelOverlayActive &&
       this.panelFocusMeta &&
       this.els.panelOverlay) {
     const overlayRect = this.els.panelOverlay.getBoundingClientRect();
     if (overlayRect.width > 1 && overlayRect.height > 1) {
       const localX = clamp((pos.x - overlayRect.left) / overlayRect.width, 0, 1);
       const localY = clamp((pos.y - overlayRect.top) / overlayRect.height, 0, 1);
       const panel = this.panelFocusMeta.panel;
       const pageRelX = clamp(panel.x + localX * panel.w, 0, 1);
       const pageRelY = clamp(panel.y + localY * panel.h, 0, 1);

       const bubble = await BubbleDetect.extract(
         url, pageRelX, pageRelY, logger
       );

       if (!this.comic || this.comic.id !== comicId || this.index !== pageIndex) return;

       if (bubble) {
         // Return to the real page geometry for the bubble overlay, then put
         // the detected bubble on top as the new focus owner.
         const ctx = this.getPanelImageContext();
         const imgRect = ctx?.rect || stageRect;
         this.removePanelOverlay(false);
         this.focusMode = null;
         this.setFocusDim(false, false);
         this.showBubbleOverlay(bubble, stageRect, imgRect);
       } else {
         // No bubble at the double-tapped location: the focused frame owns
         // this interaction, so close it.
         this._deferredPanelTap = null;
         this.resetZoom({ animate: true });
       }
       return;
     }

     this.resetZoom({ animate: true });
     return;
   }

   // Normal page (no panel focus): use the actual Turn.js-visible image.
   const ctx = this.getPanelImageContext();
   const imgRect = ctx?.rect || stageRect;
   if (!imgRect.width || !imgRect.height) return;

   const relXImg = clamp((pos.x - imgRect.left) / imgRect.width, 0, 1);
   const relYImg = clamp((pos.y - imgRect.top) / imgRect.height, 0, 1);

   const bubble = await BubbleDetect.extract(url, relXImg, relYImg, logger);
   if (!this.comic || this.comic.id !== comicId || this.index !== pageIndex) return;

   if (bubble) {
     this.showBubbleOverlay(bubble, stageRect, imgRect);
   }
 },

 showBubbleOverlay(bubble, stageRect, imgRect, anchorPage = null) {
   this.removeBubbleOverlay();
   const canvas = bubble.canvas;
   if (!canvas) return;

   const bubbleW = bubble.w * imgRect.width;
   const bubbleH = bubble.h * imgRect.height;
   if (bubbleW < 8 || bubbleH < 8) return;

   const pagePadding = Math.max(8, Math.min(18, Math.round(Math.min(imgRect.width, imgRect.height) * 0.018)));
   const availableW = Math.max(1, imgRect.width - pagePadding * 2);
   const availableH = Math.max(1, imgRect.height - pagePadding * 2);

   const smallestDimension = Math.min(bubble.w, bubble.h);
   const sizeBoost =
     smallestDimension < 0.045 ? 1.28 :
     smallestDimension < 0.075 ? 1.16 :
     smallestDimension < 0.12 ? 1.08 : 1.0;

   const preferredScale = Math.min(
     stageRect.width / (bubbleW * 1.04),
     stageRect.height / (bubbleH * 1.04)
   ) * sizeBoost;
   const fitScale = Math.min(availableW / bubbleW, availableH / bubbleH);
   const targetScale = clamp(Math.min(preferredScale, fitScale), 1.35, 7);

   const displayW = bubbleW * targetScale;
   const displayH = bubbleH * targetScale;
   const naturalCenterX = imgRect.left + (bubble.x + bubble.w / 2) * imgRect.width;
   const naturalCenterY = imgRect.top + (bubble.y + bubble.h / 2) * imgRect.height;

   const minLeft = imgRect.left + pagePadding;
   const maxLeft = imgRect.right - pagePadding - displayW;
   const minTop = imgRect.top + pagePadding;
   const maxTop = imgRect.bottom - pagePadding - displayH;
   const left = clamp(naturalCenterX - displayW / 2, minLeft, Math.max(minLeft, maxLeft));
   const top = clamp(naturalCenterY - displayH / 2, minTop, Math.max(minTop, maxTop));

   const overlay = document.createElement("canvas");
   overlay.className = "bubble-zoom-alt-overlay";
   overlay.width = canvas.width;
   overlay.height = canvas.height;
   overlay.style.width = `${displayW}px`;
   overlay.style.height = `${displayH}px`;
   overlay.style.transformOrigin = "center center";
   overlay.style.willChange = "transform, opacity, filter";

   if (anchorPage) {
     const pageRect = anchorPage.getBoundingClientRect();
     overlay.style.left = `${left - pageRect.left}px`;
     overlay.style.top = `${top - pageRect.top}px`;
     overlay.dataset.anchorPage = anchorPage.dataset.index ?? "";
   } else {
     overlay.style.left = `${left - stageRect.left}px`;
     overlay.style.top = `${top - stageRect.top}px`;
   }

   overlay.setAttribute("aria-hidden", "true");
   const ctx = overlay.getContext("2d");
   ctx.imageSmoothingEnabled = true;
   ctx.imageSmoothingQuality = "high";
   ctx.drawImage(canvas, 0, 0);

   this.setFocusDim(true, true);
   if (anchorPage) anchorPage.appendChild(overlay);
   else this.els.stage.appendChild(overlay);

   this.els.bubbleOverlay = overlay;
   this.bubbleOverlayActive = true;
   this.focusMode = "bubble";

   const zoomInDuration = 560;
   const animation = overlay.animate(
     [
       { transform: "scale(.82)", opacity: 0, filter: "brightness(.92)" },
       { transform: "scale(1.035)", opacity: 1, filter: "brightness(1.02)", offset: .72 },
       { transform: "scale(1)", opacity: 1, filter: "brightness(1)" }
     ],
     { duration: zoomInDuration, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" }
   );
   overlay._bubbleZoomInAnimation = animation;

   animation.onfinish = () => {
     if (!overlay.parentNode) return;
     overlay.style.transform = "scale(1)";
     overlay.style.opacity = "1";
     overlay.style.filter = "brightness(1)";
     animation.cancel();
     overlay._bubbleZoomInAnimation = null;
   };
   animation.oncancel = () => { overlay._bubbleZoomInAnimation = null; };
 },

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
     const pageSpanning = widthRatio >= 0.86 || heightRatio >= 0.86 || areaRatio >= 0.68;
     if (pageSpanning) {
       const coverage = Math.max(widthRatio, heightRatio);
       const focusScale = 1.14 - (coverage - 0.68) * 0.24;
       targetScale = clamp(focusScale, 1.035, 1.14);
     } else {
       targetScale *= 0.90;
       targetScale = clamp(targetScale, 1.08, maxScale);
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

   this.scale = targetScale;
   this.tx = -dx * targetScale;
   this.ty = -dy * targetScale;
   this.constrainPan();
   this.applyTransform();
 },

 async zoomToPanel(panel, stageRect, imgRect) {
   if (this.focusMode) return;
   const token = ++this.panelOverlayToken;
   const ctx = this.getPanelImageContext();
   const img = ctx?.img;
   if (!img || !img.naturalWidth || !img.naturalHeight) return;

   this.focusMode = "panel";
   this.panelOverlayActive = false;
   this.setFocusDim(true, true);

   const sourceLeft = imgRect.left + panel.x * imgRect.width;
   const sourceTop = imgRect.top + panel.y * imgRect.height;
   const sourceW = Math.max(8, panel.w * imgRect.width);
   const sourceH = Math.max(8, panel.h * imgRect.height);

   const naturalW = Math.max(1, Math.round(panel.w * img.naturalWidth));
   const naturalH = Math.max(1, Math.round(panel.h * img.naturalHeight));
   const renderScale = Math.min(1, 3000 / Math.max(naturalW, naturalH));
   const canvasW = Math.max(1, Math.round(naturalW * renderScale));
   const canvasH = Math.max(1, Math.round(naturalH * renderScale));
   const sx = panel.x * img.naturalWidth;
   const sy = panel.y * img.naturalHeight;
   const sw = panel.w * img.naturalWidth;
   const sh = panel.h * img.naturalHeight;

   this.panelFocusMeta = {
     panel: { x: panel.x, y: panel.y, w: panel.w, h: panel.h },
     pageIndex: this.index
   };

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

   const pagePad = Math.max(8, Math.min(18, Math.round(Math.min(imgRect.width, imgRect.height) * 0.018)));
   const availableW = Math.max(1, imgRect.width - pagePad * 2);
   const availableH = Math.max(1, imgRect.height - pagePad * 2);
   const fitScale = Math.min(availableW / sourceW, availableH / sourceH);
   const areaRatio = panel.w * panel.h;
   const pageSpanning = panel.w >= 0.86 || panel.h >= 0.86 || areaRatio >= 0.68;

   let targetScale;
   if (pageSpanning) {
     targetScale = clamp(Math.min(1.08, fitScale), 1, 1.08);
   } else {
     targetScale = clamp(Math.min(fitScale * 0.94, 4.5), 1.08, 4.5);
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
     };

     animation.oncancel = () => {
       overlay._panelZoomInAnimation = null;
     };
   });
 }
};

// Global clamp helper check
function clamp(val, min, max) {
 return Math.min(Math.max(val, min), max);
}