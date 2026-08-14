// library.js — import, sort, series bundling, and collection management

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif)$/i;
const SORT_KEY = "longbox_sort";

// ---------------- Reusable modal ----------------
const Modal = {
  el: null, box: null,
  init() {
    this.el = document.getElementById("modal-overlay");
    this.box = document.getElementById("modal-box");
    this.el.addEventListener("click", (e) => {
      if (e.target === this.el) this.close();
    });
  },
  open(html) {
    this.box.innerHTML = html;
    this.el.style.display = "flex";
  },
  close() {
    this.el.style.display = "none";
    this.box.innerHTML = "";
  },
  // Simple action sheet: title, optional subtitle, list of {label, cls, onClick}
  actions(title, subtitle, buttons) {
    this.open(`
      <div class="modal-title">${escapeHtml(title)}</div>
      ${subtitle ? `<div class="modal-subtitle">${escapeHtml(subtitle)}</div>` : ""}
      <div class="modal-actions" id="modal-actions-list"></div>
    `);
    const list = document.getElementById("modal-actions-list");
    buttons.forEach((b) => {
      const btn = document.createElement("button");
      btn.className = `modal-btn ${b.cls || "neutral"}`;
      btn.textContent = b.label;
      btn.addEventListener("click", () => {
        this.close();
        if (b.onClick) b.onClick();
      });
      list.appendChild(btn);
    });
  },
};

// ---------------- Series-name parsing ----------------
// Splits "Batman 001 (2016).cbz" -> { seriesTitle: "Batman", issueNumber: 1 }
function parseSeriesInfo(filename) {
  const name = filename.replace(/\.(cbz|zip)$/i, "").trim();
  const m = name.match(/^(.*?)[\s._-]*#?(?:v(?:ol)?\.?\s*)?(\d{1,4})(?:\s*\([^)]*\))?\s*$/i);
  if (m && m[1].trim().length > 1) {
    return {
      seriesTitle: m[1].trim().replace(/[\s._-]+$/, ""),
      seriesKey: normalizeKey(m[1]),
      issueNumber: parseInt(m[2], 10),
    };
  }
  return { seriesTitle: null, seriesKey: null, issueNumber: null };
}
function normalizeKey(s) {
  return s.toLowerCase().replace(/[_.\-]+/g, " ").replace(/[^\w\s]/g, "").trim().replace(/\s+/g, " ");
}

const Library = {
  els: {},
  sort: localStorage.getItem(SORT_KEY) || "recent",
  activeCollectionId: null,

  init() {
    Modal.init();

    this.els.root = document.getElementById("library-root");
    this.els.collectionView = document.getElementById("collection-view");
    this.els.gridEl = document.getElementById("comic-grid");
    this.els.emptyEl = document.getElementById("empty-state");
    this.els.countEl = document.getElementById("lib-count");
    this.els.toolbar = document.getElementById("lib-toolbar");
    this.els.progressEl = document.getElementById("import-progress");
    this.els.progressText = document.getElementById("import-progress-text");
    this.els.collectionGrid = document.getElementById("collection-grid");
    this.els.collectionTitle = document.getElementById("collection-title");
    this.els.collectionCount = document.getElementById("collection-count");

    document.getElementById("import-input").addEventListener("change", (e) => {
      this.handleFiles(e.target.files);
      e.target.value = "";
    });

    document.querySelectorAll("#sort-row .pill").forEach((btn) => {
      btn.addEventListener("click", () => this.setSort(btn.dataset.sort));
    });

    document.getElementById("new-collection-btn").addEventListener("click", () => this.promptNewCollection());
    document.getElementById("collection-back").addEventListener("click", () => this.showRoot());
    document.getElementById("collection-menu").addEventListener("click", () => this.openCollectionMenu(this.activeCollectionId));

    this.updateSortPills();
    this.refresh();
  },

  showRoot() {
    this.activeCollectionId = null;
    this.els.collectionView.style.display = "none";
    this.els.root.style.display = "block";
    this.refresh();
  },

  showCollection(id) {
    this.activeCollectionId = id;
    this.els.root.style.display = "none";
    this.els.collectionView.style.display = "block";
    this.refreshCollectionView();
  },

  setSort(sort) {
    this.sort = sort;
    localStorage.setItem(SORT_KEY, sort);
    this.updateSortPills();
    this.refresh();
  },
  updateSortPills() {
    document.querySelectorAll("#sort-row .pill").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.sort === this.sort);
    });
  },

  sortItems(items) {
    const arr = items.slice();
    switch (this.sort) {
      case "title":
        arr.sort((a, b) => (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" }));
        break;
      case "unread":
        arr.sort((a, b) => unreadScore(a) - unreadScore(b));
        break;
      case "progress":
        arr.sort((a, b) => progressPct(b) - progressPct(a));
        break;
      case "recent":
      default:
        arr.sort((a, b) => (b.lastOpenedAt || b.addedAt || b.createdAt || 0) - (a.lastOpenedAt || a.addedAt || a.createdAt || 0));
    }
    return arr;
  },

  async refresh() {
    if (this.activeCollectionId) return this.refreshCollectionView();

    const [comics, collections] = await Promise.all([LongboxDB.getAllComics(), LongboxDB.getAllCollections()]);
    const standalone = comics.filter((c) => !c.collectionId);

    const totalCount = standalone.length + collections.length;
    this.els.countEl.textContent = comics.length ? `${comics.length} book${comics.length === 1 ? "" : "s"}` : "";
    this.els.toolbar.style.display = totalCount ? "flex" : "none";
    this.els.emptyEl.style.display = totalCount ? "none" : "block";
    this.els.gridEl.style.display = totalCount ? "grid" : "none";
    this.els.gridEl.innerHTML = "";

    // enrich collections with aggregate stats for sorting/progress display
    const enrichedCollections = collections.map((col) => {
      const members = comics.filter((c) => c.collectionId === col.id);
      const totalPages = members.reduce((s, c) => s + (c.pageCount || 0), 0);
      const readPages = members.reduce((s, c) => s + Math.min((c.lastPage || 0) + 1, c.pageCount || 0), 0);
      const cover = members.sort((a, b) => (a.issueNumber ?? 999999) - (b.issueNumber ?? 999999))[0];
      return {
        ...col,
        _isCollection: true,
        _memberCount: members.length,
        _progressPct: totalPages ? Math.round((readPages / totalPages) * 100) : 0,
        _cover: cover,
        lastOpenedAt: Math.max(col.createdAt || 0, ...members.map((c) => c.lastOpenedAt || 0), 0),
      };
    });

    const items = this.sortItems([...standalone, ...enrichedCollections]);
    items.forEach((item) => {
      this.els.gridEl.appendChild(item._isCollection ? this.renderCollectionCard(item) : this.renderComicCard(item));
    });
  },

  async refreshCollectionView() {
    const col = await LongboxDB.getCollection(this.activeCollectionId);
    if (!col) { this.showRoot(); return; }
    const comics = await LongboxDB.getAllComics();
    let members = this.sortItems(comics.filter((c) => c.collectionId === col.id));
    // within a collection, default useful order is issue number when sort is "recent"
    if (this.sort === "recent") {
      members = members.slice().sort((a, b) => (a.issueNumber ?? 999999) - (b.issueNumber ?? 999999));
    }

    this.els.collectionTitle.textContent = col.title;
    this.els.collectionCount.textContent = `${members.length} issue${members.length === 1 ? "" : "s"}`;
    this.els.collectionGrid.innerHTML = "";
    members.forEach((m) => this.els.collectionGrid.appendChild(this.renderComicCard(m, { inCollection: true })));
  },

  renderComicCard(comic, opts = {}) {
    const card = document.createElement("div");
    card.className = "comic-card";
    card.dataset.id = comic.id;
    const pct = progressPct(comic);

    card.innerHTML = `
      <div class="comic-cover">
        <img src="${comic.coverUrl}" alt="" loading="lazy" />
        <div class="comic-progress-bar"><div class="comic-progress-fill" style="width:${pct}%"></div></div>
        <button class="card-menu-btn" aria-label="Comic options">⋮</button>
      </div>
      <div class="comic-title">${escapeHtml(comic.title)}</div>
    `;

    card.querySelector(".card-menu-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      this.openComicMenu(comic, opts.inCollection);
    });
    card.addEventListener("click", () => window.LongboxApp.openReader(comic.id));
    return card;
  },

  renderCollectionCard(col) {
    const card = document.createElement("div");
    card.className = "comic-card collection-card";
    card.dataset.id = col.id;
    const cover = col._cover;

    card.innerHTML = `
      <div class="comic-cover">
        ${cover ? `<img src="${cover.coverUrl}" alt="" loading="lazy" />` : ""}
        <div class="comic-progress-bar"><div class="comic-progress-fill" style="width:${col._progressPct}%"></div></div>
        <span class="collection-badge">${col._memberCount} issue${col._memberCount === 1 ? "" : "s"}</span>
        <button class="card-menu-btn" aria-label="Collection options">⋮</button>
      </div>
      <div class="comic-title">${escapeHtml(col.title)}</div>
    `;

    card.querySelector(".card-menu-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      this.openCollectionMenu(col.id);
    });
    card.addEventListener("click", () => this.showCollection(col.id));
    return card;
  },

  // ---------------- Card action menus ----------------
  openComicMenu(comic, inCollection) {
    const buttons = [];
    if (inCollection) {
      buttons.push({
        label: "Remove from collection",
        cls: "neutral",
        onClick: async () => {
          await LongboxDB.updateComic(comic.id, { collectionId: null });
          this.refreshCollectionView();
        },
      });
    } else {
      buttons.push({
        label: "Add to collection",
        cls: "neutral",
        onClick: () => this.openAddToCollection(comic),
      });
    }
    buttons.push({
      label: "Delete comic",
      cls: "danger",
      onClick: () => {
        Modal.actions(`Delete "${comic.title}"?`, "This can't be undone.", [
          { label: "Delete", cls: "danger", onClick: async () => {
              await LongboxDB.deleteComic(comic.id);
              inCollection ? this.refreshCollectionView() : this.refresh();
            } },
          { label: "Cancel", cls: "subtle" },
        ]);
      },
    });
    buttons.push({ label: "Cancel", cls: "subtle" });
    Modal.actions(comic.title, null, buttons);
  },

  openCollectionMenu(id) {
    if (!id) return;
    Modal.actions("Collection options", null, [
      {
        label: "Rename collection",
        cls: "neutral",
        onClick: () => this.promptRenameCollection(id),
      },
      {
        label: "Remove collection, keep issues",
        cls: "neutral",
        onClick: async () => {
          await LongboxDB.ungroupCollection(id);
          this.showRoot();
        },
      },
      {
        label: "Delete collection & all issues",
        cls: "danger",
        onClick: async () => {
          const col = await LongboxDB.getCollection(id);
          Modal.actions(`Delete "${col.title}"?`, "This deletes the collection and every issue inside it. This can't be undone.", [
            { label: "Delete everything", cls: "danger", onClick: async () => {
                await LongboxDB.deleteCollectionAndComics(id);
                this.showRoot();
              } },
            { label: "Cancel", cls: "subtle" },
          ]);
        },
      },
      { label: "Cancel", cls: "subtle" },
    ]);
  },

  async openAddToCollection(comic) {
    const collections = await LongboxDB.getAllCollections();
    const listHtml = collections.length
      ? collections.map((c) => `<button class="modal-list-item" data-id="${c.id}">${escapeHtml(c.title)}</button>`).join("")
      : `<p class="modal-empty-note">No collections yet.</p>`;

    Modal.open(`
      <div class="modal-title">Add "${escapeHtml(comic.title)}" to…</div>
      <div class="modal-list">${listHtml}</div>
      <input class="modal-input" id="new-col-input" placeholder="New collection name" />
      <div class="modal-actions">
        <button class="modal-btn primary" id="new-col-create">Create &amp; add</button>
        <button class="modal-btn subtle" id="modal-cancel">Cancel</button>
      </div>
    `);

    Modal.box.querySelectorAll(".modal-list-item").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await LongboxDB.updateComic(comic.id, { collectionId: btn.dataset.id });
        this.autoAssignIssueNumber(comic);
        Modal.close();
        this.refresh();
      });
    });
    document.getElementById("new-col-create").addEventListener("click", async () => {
      const name = document.getElementById("new-col-input").value.trim();
      if (!name) return;
      const id = await this.createCollection(name);
      await LongboxDB.updateComic(comic.id, { collectionId: id });
      this.autoAssignIssueNumber(comic);
      Modal.close();
      this.refresh();
    });
    document.getElementById("modal-cancel").addEventListener("click", () => Modal.close());
  },

  autoAssignIssueNumber(comic) {
    if (comic.issueNumber != null) return;
    const info = parseSeriesInfo(comic.title);
    if (info.issueNumber != null) {
      LongboxDB.updateComic(comic.id, { issueNumber: info.issueNumber });
    }
  },

  promptNewCollection() {
    Modal.open(`
      <div class="modal-title">New collection</div>
      <input class="modal-input" id="new-col-input-2" placeholder="Collection name (e.g. Batman)" autofocus />
      <div class="modal-actions">
        <button class="modal-btn primary" id="new-col-confirm">Create</button>
        <button class="modal-btn subtle" id="modal-cancel-2">Cancel</button>
      </div>
    `);
    document.getElementById("new-col-confirm").addEventListener("click", async () => {
      const name = document.getElementById("new-col-input-2").value.trim();
      if (!name) return;
      await this.createCollection(name);
      Modal.close();
      this.refresh();
    });
    document.getElementById("modal-cancel-2").addEventListener("click", () => Modal.close());
  },

  promptRenameCollection(id) {
    LongboxDB.getCollection(id).then((col) => {
      Modal.open(`
        <div class="modal-title">Rename collection</div>
        <input class="modal-input" id="rename-col-input" value="${escapeHtml(col.title)}" autofocus />
        <div class="modal-actions">
          <button class="modal-btn primary" id="rename-col-confirm">Save</button>
          <button class="modal-btn subtle" id="modal-cancel-3">Cancel</button>
        </div>
      `);
      document.getElementById("rename-col-confirm").addEventListener("click", async () => {
        const name = document.getElementById("rename-col-input").value.trim();
        if (!name) return;
        await LongboxDB.updateCollection(id, { title: name });
        Modal.close();
        this.activeCollectionId ? this.refreshCollectionView() : this.refresh();
      });
      document.getElementById("modal-cancel-3").addEventListener("click", () => Modal.close());
    });
  },

  async createCollection(title) {
    const id = `col_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await LongboxDB.addCollection({ id, title, createdAt: Date.now() });
    return id;
  },

  // ---------------- Import ----------------
  async handleFiles(fileList) {
    const files = Array.from(fileList).filter((f) => /\.cbz$/i.test(f.name) || /\.zip$/i.test(f.name));
    if (!files.length) {
      alert("Please choose a .cbz (or .zip) file.");
      return;
    }
    this.els.progressEl.classList.add("active");
    const importedIds = [];
    for (const file of files) {
      try {
        this.els.progressText.textContent = `Importing ${file.name}…`;
        const id = await this.importCbz(file);
        importedIds.push(id);
      } catch (err) {
        console.error(err);
        alert(`Couldn't import ${file.name}: ${err.message}`);
      }
    }
    this.els.progressEl.classList.remove("active");
    this.showRoot();
    await this.suggestBundles(importedIds);
  },

  async importCbz(file) {
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files)
      .filter((f) => !f.dir && IMAGE_EXT.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

    if (!entries.length) throw new Error("No images found inside archive");

    const id = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let coverUrl = null;

    for (let i = 0; i < entries.length; i++) {
      this.els.progressText.textContent = `Importing ${file.name}… (${i + 1}/${entries.length})`;
      const blob = await entries[i].async("blob");
      const typedBlob = blob.type ? blob : new Blob([blob], { type: guessMime(entries[i].name) });
      await LongboxDB.putPage(id, i, typedBlob);
      if (i === 0) {
        coverUrl = await blobToDataUrl(await makeThumbnail(typedBlob));
      }
    }

    const title = file.name.replace(/\.(cbz|zip)$/i, "");
    const info = parseSeriesInfo(title);

    await LongboxDB.addComic({
      id,
      title,
      pageCount: entries.length,
      coverUrl,
      lastPage: 0,
      bookmarks: [],
      readMode: "single",
      addedAt: Date.now(),
      collectionId: null,
      issueNumber: info.issueNumber,
      seriesKey: info.seriesKey,
    });
    return id;
  },

  // After an import batch, look for standalone comics (new + pre-existing) that
  // share a detected series name, and offer to bundle each group in turn.
  async suggestBundles(importedIds) {
    if (!importedIds.length) return;
    const comics = await LongboxDB.getAllComics();
    const standalone = comics.filter((c) => !c.collectionId && c.seriesKey);
    const newKeys = new Set(
      comics.filter((c) => importedIds.includes(c.id) && c.seriesKey).map((c) => c.seriesKey),
    );

    const groups = {};
    standalone.forEach((c) => {
      if (!newKeys.has(c.seriesKey)) return;
      (groups[c.seriesKey] = groups[c.seriesKey] || []).push(c);
    });

    const candidates = Object.values(groups).filter((g) => g.length >= 2);
    for (const group of candidates) {
      await this.askToBundle(group);
    }
  },

  askToBundle(group) {
    return new Promise((resolve) => {
      const seriesTitle = parseSeriesInfo(group[0].title).seriesTitle || group[0].title;
      Modal.actions(
        `Bundle "${seriesTitle}"?`,
        `Found ${group.length} issues that look like the same series. Bundle them into a collection?`,
        [
          {
            label: `Create collection (${group.length} issues)`,
            cls: "primary",
            onClick: async () => {
              const id = await this.createCollection(seriesTitle);
              for (const c of group) {
                await LongboxDB.updateComic(c.id, { collectionId: id });
              }
              this.showRoot();
              resolve();
            },
          },
          { label: "Not now", cls: "subtle", onClick: () => resolve() },
        ],
      );
    });
  },
};

function unreadScore(comic) {
  if (comic._isCollection) return -(comic._progressPct);
  return progressPct(comic); // lower = more unread, sorts first
}
function progressPct(comic) {
  if (comic._isCollection) return comic._progressPct;
  if (!comic.pageCount) return 0;
  return Math.round((((comic.lastPage || 0) + 1) / comic.pageCount) * 100);
}

function guessMime(name) {
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.gif$/i.test(name)) return "image/gif";
  if (/\.webp$/i.test(name)) return "image/webp";
  return "image/jpeg";
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : s;
  return div.innerHTML;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function makeThumbnail(blob, maxW = 300) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob((thumbBlob) => {
        URL.revokeObjectURL(url);
        resolve(thumbBlob);
      }, "image/jpeg", 0.82);
    };
    img.onerror = reject;
    img.src = url;
  });
}

window.Library = Library;
