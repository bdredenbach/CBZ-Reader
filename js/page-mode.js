/* Longbox Page Mode — isolated physical-page renderer
 * v60 experimental module
 * StPageFlip is intentionally isolated here so the other reading modes remain untouched.
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
      this.flip = null;
      this.issueKey = null;
      this.pages = [];
    }

    async destroy() {
      if (this.flip) {
        try { this.flip.destroy(); } catch (_) {}
      }
      this.flip = null;
      this.issueKey = null;
      this.pages = [];
      if (this.host) {
        this.host.innerHTML = "";
        this.host.style.display = "none";
      }
    }

    async render(host) {
      this.host = host;
      const issue = this.getIssue();
      if (!issue || !window.St?.PageFlip) return false;

      const issueKey = issue.id ?? issue.key ?? issue.title ?? "issue";
      if (this.flip && this.issueKey === issueKey) {
        this.host.style.display = "block";
        return true;
      }

      await this.destroy();

      host.style.display = "block";
      host.style.position = "absolute";
      host.style.inset = "0";
      host.style.width = "100%";
      host.style.height = "100%";

      await new Promise(resolve =>
        requestAnimationFrame(() =>
          requestAnimationFrame(resolve)
        )
      );

      const rect = host.getBoundingClientRect();
      const width = Math.max(240, Math.round(rect.width || window.innerWidth));
      const height = Math.max(360, Math.round(rect.height || window.innerHeight));

      // Fetch page URLs in parallel. The previous experimental version
      // awaited 74 IndexedDB reads one-by-one, which could leave Page Mode
      // sitting on "Loading page..." for a long time before StPageFlip even
      // received its first page.
      const urls = await Promise.all(
        Array.from({ length: issue.pageCount }, (_, i) => this.getPageUrl(i))
      );

      const pages = urls.map((url, i) => {
        const page = document.createElement("div");
        page.className = "longbox-flip-page";
        page.dataset.density = "soft";
        page.dataset.index = String(i);

        const img = document.createElement("img");
        img.alt = "";
        img.draggable = false;
        img.decoding = "async";
        if (url) img.src = url;

        page.appendChild(img);
        return page;
      }).filter((page) => page.querySelector("img")?.src);

      if (!pages.length) return false;
      this.pages = pages;

      const flip = new St.PageFlip(host, {
        width,
        height,
        size: "stretch",
        minWidth: 240,
        maxWidth: width,
        minHeight: 360,
        maxHeight: height,
        autoSize: false,
        showCover: false,
        usePortrait: true,
        drawShadow: true,
        maxShadowOpacity: 0.65,
        flippingTime: 900,
        mobileScrollSupport: false,
        swipeDistance: 20,
        clickEventForward: true,
        useMouseEvents: true
      });

      flip.on("flip", e => {
        const index = Number(e.data);
        if (!Number.isInteger(index)) return;
        this.setIndex(index);
        this.onPageChanged(index);
      });

      flip.on("changeState", e => {
        this.onState(e.data);
      });

      flip.on("changeOrientation", e => {
        this.onState(`orientation=${e.data}`);
      });

      flip.on("init", e => {
        this.onState(`init=${e.data?.mode || "unknown"}`);
      });

      // IMPORTANT: HTML pages with data-density="soft" use StPageFlip's
      // polygon-based soft-page renderer. loadFromImages uses the canvas
      // renderer and does not expose the soft/hard HTML page density.
      flip.loadFromHtml(pages);

      await new Promise(resolve => requestAnimationFrame(resolve));

      const index = Math.max(
        0,
        Math.min(this.getIndex(), pages.length - 1)
      );
      flip.turnToPage(index);

      this.flip = flip;
      this.issueKey = issueKey;
      return true;
    }

    next() {
      if (this.flip) this.flip.flipNext("bottom");
    }

    prev() {
      if (this.flip) this.flip.flipPrev("bottom");
    }

    goTo(index) {
      if (this.flip) {
        const i = Math.max(0, Math.min(index, this.pages.length - 1));
        this.flip.turnToPage(i);
      }
    }
  }

  return PageMode;
})();
