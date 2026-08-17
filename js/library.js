// library.js — import, sort, series bundling, and collection management

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif)$/i;
const ARCHIVE_EXT = /\.(cbz|zip|cbt|tar|cb7|7z|cbr|rar)$/i;
const SORT_KEY = "longbox_sort";
const SORT_DIR_KEY = "longbox_sort_direction";

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
// Real-world scan filenames stack several metadata groups after the issue
// number — "Wolverine Origin 04 (of 6) (2002) (Digital) (Zone-Empire)" — so
// a single regex pattern misses most of them. We strip metadata groups first,
// then try several progressively looser strategies until one sticks.

// Repeatedly remove (...)/[...] groups — these are almost always metadata
// (year, "of N", scan/release group, format), not part of the series name.
function stripMetaGroups(s) {
  let prev, out = s;
  do {
    prev = out;
    out = out.replace(/\([^()]*\)/g, " ").replace(/\[[^\[\]]*\]/g, " ");
  } while (out !== prev);
  return out.replace(/\s+/g, " ").trim();
}

function buildSeriesResult(rawTitle, rawNum) {
  const title = rawTitle.trim().replace(/[\s._-]+$/, "");
  if (!title) return null;
  return { seriesTitle: title, seriesKey: normalizeKey(title), issueNumber: parseInt(rawNum, 10) };
}

function parseSeriesInfo(filename) {
  const raw = filename.replace(/\.(cbz|zip)$/i, "").trim();
  const core = stripMetaGroups(raw);
  let m, result;

  // Strategy 1: explicit issue marker — "#23", "Issue 23", "Ch. 23", "Vol 2"
  m = core.match(/^(.*?)[\s._-]+(?:#|issue\s*|iss\.?\s*|ch(?:apter)?\.?\s*|v(?:ol(?:ume)?)?\.?\s*)(\d{1,4})\b/i);
  if (m && (result = buildSeriesResult(m[1], m[2]))) return result;

  // Strategy 2: trailing number once metadata parens/brackets are stripped away
  // (this is what fixes "Title 04 (of 6) (2002) (Digital) (Group)")
  m = core.match(/^(.*?)[\s._-]+(\d{1,4})\s*$/);
  if (m && (result = buildSeriesResult(m[1], m[2]))) return result;

  // Strategy 3: same shape, but on the raw string, in case the number itself
  // was accidentally inside what looked like a metadata group
  m = raw.match(/^(.*?)[\s._-]+#?(\d{1,4})(?:\s*[\(\[][^\)\]]*[\)\]])*\s*$/i);
  if (m && (result = buildSeriesResult(m[1], m[2]))) return result;

  // Strategy 4: loosest fallback — first short (1–3 digit) number anywhere in
  // the stripped core, favoring issue-number-like values over 4-digit years
  m = core.match(/^(.*?)[\s._-]+(\d{1,3})(?:[\s._-]|$)/);
  if (m && (result = buildSeriesResult(m[1], m[2]))) return result;

  return { seriesTitle: null, seriesKey: null, issueNumber: null };
}
function normalizeKey(s) {
  return s.toLowerCase().replace(/[_.\-]+/g, " ").replace(/[^\w\s]/g, "").trim().replace(/\s+/g, " ");
}

const Library = {
  els: {},
  sort: localStorage.getItem(SORT_KEY) || "recent",
  sortDirection: localStorage.getItem(SORT_DIR_KEY) || "",
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

    document.querySelectorAll("#sort-row .pill[data-sort], #collection-sort-row .pill[data-sort]").forEach((btn) => {
      btn.addEventListener("click", () => this.setSort(btn.dataset.sort));
    });
    document.getElementById("sort-direction-btn").addEventListener("click", () => this.toggleSortDirection());
    document.getElementById("collection-sort-direction-btn").addEventListener("click", () => this.toggleSortDirection());
    document.getElementById("install-app-btn").addEventListener("click", () => window.LongboxApp.installPWA?.());

    document.getElementById("detect-series-btn").addEventListener("click", () => this.detectSeriesNow());
    document.getElementById("new-collection-btn").addEventListener("click", () => this.promptNewCollection());
    document.getElementById("backup-btn").addEventListener("click", () => this.openBackupMenu());
    document.getElementById("restore-input").addEventListener("change", (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (file) this.restoreBackup(file);
    });
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
    this.updateSortPills();
    this.refreshCollectionView();
  },

  setSort(sort) {
    const changed = this.sort !== sort;
    this.sort = sort;
    if (changed) {
      this.sortDirection = this.defaultSortDirection(sort);
    }
    localStorage.setItem(SORT_KEY, sort);
    localStorage.setItem(SORT_DIR_KEY, this.sortDirection);
    this.updateSortPills();
    this.refresh();
  },

  defaultSortDirection(sort) {
    return (sort === "recent" || sort === "progress") ? "desc" : "asc";
  },

  toggleSortDirection() {
    this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
    localStorage.setItem(SORT_DIR_KEY, this.sortDirection);
    this.updateSortDirectionUI();
    this.refresh();
  },

  updateSortPills() {
    document.querySelectorAll("#sort-row .pill[data-sort], #collection-sort-row .pill[data-sort]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.sort === this.sort);
    });
    if (!this.sortDirection) {
      this.sortDirection = this.defaultSortDirection(this.sort);
      localStorage.setItem(SORT_DIR_KEY, this.sortDirection);
    }
    this.updateSortDirectionUI();
  },

  updateSortDirectionUI() {
    const descending = this.sortDirection === "desc";
    document.querySelectorAll("#sort-direction-btn, #collection-sort-direction-btn").forEach((btn) => {
      btn.textContent = descending ? "↓ Desc" : "↑ Asc";
      btn.setAttribute("aria-label", descending ? "Sort descending" : "Sort ascending");
      btn.title = descending ? "Sort descending" : "Sort ascending";
    });
  },

  sortItems(items) {
    const arr = items.slice();
    const dir = this.sortDirection === "desc" ? -1 : 1;
    arr.sort((a, b) => {
      let result = 0;
      switch (this.sort) {
        case "title":
          result = (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" });
          break;
        case "unread":
          result = unreadScore(a) - unreadScore(b);
          break;
        case "progress":
          result = progressPct(a) - progressPct(b);
          break;
        case "recent":
        default:
          result = (a.lastOpenedAt || a.addedAt || a.createdAt || 0) - (b.lastOpenedAt || b.addedAt || b.createdAt || 0);
      }
      return result * dir;
    });
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
      const issueDir = this.sortDirection === "desc" ? -1 : 1;
      members = members.slice().sort((a, b) =>
        ((a.issueNumber ?? 999999) - (b.issueNumber ?? 999999)) * issueDir
      );
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

  // ---------------- Backup / restore ----------------
  // Exports reading progress, bookmarks, and collection organization as a
  // small JSON file — deliberately NOT the page images themselves. Comics
  // are usually many hundreds of MB of image data; bundling all of that into
  // one browser-generated archive risks running out of memory on a phone,
  // and you likely still have the original .cbz files to re-import from.
  // What's actually tedious to redo by hand is progress/bookmarks/collections,
  // so that's what this protects.
  openBackupMenu() {
    Modal.actions("Backup", "Saves your reading progress, bookmarks, and collections — not the comic files themselves. Re-import your .cbz files first if restoring on a fresh install.", [
      { label: "Export backup", cls: "primary", onClick: () => this.exportBackup() },
      { label: "Restore from backup", cls: "neutral", onClick: () => document.getElementById("restore-input").click() },
      { label: "Cancel", cls: "subtle" },
    ]);
  },

  async exportBackup() {
    const [comics, collections] = await Promise.all([LongboxDB.getAllComics(), LongboxDB.getAllCollections()]);
    const collectionById = {};
    collections.forEach((c) => { collectionById[c.id] = c.title; });

    const payload = {
      app: "longbox",
      version: 1,
      exportedAt: new Date().toISOString(),
      collections: collections.map((c) => ({ title: c.title, createdAt: c.createdAt })),
      comics: comics.map((c) => ({
        title: c.title,
        pageCount: c.pageCount,
        lastPage: c.lastPage,
        bookmarks: c.bookmarks || [],
        readMode: c.readMode,
        theme: c.theme,
        issueNumber: c.issueNumber ?? null,
        seriesKey: c.seriesKey ?? null,
        collectionTitle: c.collectionId ? (collectionById[c.collectionId] || null) : null,
        addedAt: c.addedAt,
      })),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `longbox-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },

  async restoreBackup(file) {
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch (err) {
      Modal.actions("Couldn't read backup", "That file doesn't look like a valid Longbox backup.", [{ label: "OK", cls: "neutral" }]);
      return;
    }
    if (!payload || payload.app !== "longbox" || !Array.isArray(payload.comics)) {
      Modal.actions("Couldn't read backup", "That file doesn't look like a valid Longbox backup.", [{ label: "OK", cls: "neutral" }]);
      return;
    }

    const currentComics = await LongboxDB.getAllComics();
    const existingCollections = await LongboxDB.getAllCollections();
    const collectionIdByTitle = {};
    existingCollections.forEach((c) => { collectionIdByTitle[c.title] = c.id; });

    // Recreate any collections from the backup that don't already exist here.
    const neededTitles = new Set((payload.collections || []).map((c) => c.title).filter(Boolean));
    for (const title of neededTitles) {
      if (!collectionIdByTitle[title]) {
        collectionIdByTitle[title] = await this.createCollection(title);
      }
    }

    // Match backup entries to currently-imported comics by exact title —
    // titles are stable across re-imports of the same .cbz file, but IDs
    // are regenerated each time, so title is the only reliable link.
    let matched = 0;
    const unmatched = [];
    for (const entry of payload.comics) {
      const current = currentComics.find((c) => c.title === entry.title);
      if (!current) {
        unmatched.push(entry.title);
        continue;
      }
      const patch = {
        lastPage: entry.lastPage ?? current.lastPage,
        bookmarks: entry.bookmarks || [],
        readMode: entry.readMode || current.readMode,
        theme: entry.theme || current.theme,
      };
      if (entry.issueNumber != null) patch.issueNumber = entry.issueNumber;
      if (entry.seriesKey) patch.seriesKey = entry.seriesKey;
      if (entry.collectionTitle && collectionIdByTitle[entry.collectionTitle]) {
        patch.collectionId = collectionIdByTitle[entry.collectionTitle];
      }
      await LongboxDB.updateComic(current.id, patch);
      matched++;
    }

    const subtitle = unmatched.length
      ? `Restored ${matched} of ${payload.comics.length}. Not found in your library (import these first, then restore again): ${unmatched.slice(0, 6).join(", ")}${unmatched.length > 6 ? "…" : ""}`
      : `Restored progress, bookmarks, and collections for all ${matched} comics.`;
    Modal.actions("Restore complete", subtitle, [{ label: "OK", cls: "neutral" }]);
    this.showRoot();
  },

  // ---------------- Import ----------------
  async handleFiles(fileList) {
    const files = Array.from(fileList).filter((f) => ARCHIVE_EXT.test(f.name));
    if (!files.length) {
      alert("No supported comic archives found. Longbox supports CBZ, ZIP, CBT, TAR, CB7, 7Z, CBR, and RAR.");
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
    const id = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let entries;

    if (/\.(cbt|tar)$/i.test(file.name)) {
      entries = await this.readTarEntries(file);
    } else if (/\.(cb7|7z|cbr|rar)$/i.test(file.name)) {
      entries = await this.readLibarchiveEntries(file);
    } else {
      const zip = await JSZip.loadAsync(file);
      entries = Object.values(zip.files)
        .filter((f) => !f.dir && IMAGE_EXT.test(f.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
        .map((entry) => ({
          name: entry.name,
          async getBlob() {
            const blob = await entry.async("blob");
            return blob.type ? blob : new Blob([blob], { type: guessMime(entry.name) });
          },
        }));
    }

    if (!entries.length) {
      throw new Error("No supported image pages were found in this archive.");
    }

    let coverUrl = null;
    for (let i = 0; i < entries.length; i++) {
      this.els.progressText.textContent = `Importing ${file.name}… (${i + 1}/${entries.length})`;
      const typedBlob = await entries[i].getBlob();
      await LongboxDB.putPage(id, i, typedBlob);
      if (i === 0) coverUrl = await blobToDataUrl(await makeThumbnail(typedBlob));
    }

    const title = file.name.replace(ARCHIVE_EXT, "");
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

  async readLibarchiveEntries(file) {
    if (!this._filing) {
      // Use jsDelivr's browser ESM transformer. This avoids executing a
      // package's UMD/CommonJS wrapper as a plain browser script.
      const mod = await import("https://cdn.jsdelivr.net/npm/filing/+esm");
      const FilingBrowser = mod.FilingBrowser || mod.default?.FilingBrowser;
      if (!FilingBrowser) {
        throw new Error("The 7Z/RAR archive engine loaded, but its browser API was unavailable.");
      }

      this._filing = new FilingBrowser({
        wasmUrl: "https://unpkg.com/filing/dist/esm/wasm/archive.wasm",
      });
    }

    const extracted = await this._filing.extract(file);
    return extracted
      .filter((item) => IMAGE_EXT.test(item.pathname || item.filename || ""))
      .sort((a, b) =>
        (a.pathname || a.filename).localeCompare(
          b.pathname || b.filename,
          undefined,
          { numeric: true, sensitivity: "base" }
        )
      )
      .map((item) => ({
        name: item.pathname || item.filename,
        async getBlob() {
          return item.file || new Blob(
            [item.data],
            { type: item.type || guessMime(item.pathname || item.filename) }
          );
        },
      }));
  },

  async readTarEntries(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entries = [];
    let offset = 0;

    const readString = (start, length) => {
      const slice = bytes.subarray(start, start + length);
      let end = 0;
      while (end < slice.length && slice[end] !== 0) end++;
      return new TextDecoder().decode(slice.subarray(0, end)).trim();
    };
    const readOctal = (start, length) => {
      const raw = readString(start, length).trim();
      return raw ? (parseInt(raw, 8) || 0) : 0;
    };

    while (offset + 512 <= bytes.length) {
      const header = bytes.subarray(offset, offset + 512);
      let allZero = true;
      for (let i = 0; i < header.length; i++) {
        if (header[i] !== 0) { allZero = false; break; }
      }
      if (allZero) break;

      const name = readString(offset, 100);
      const prefix = readString(offset + 345, 155);
      const fullName = prefix ? `${prefix}/${name}` : name;
      const size = readOctal(offset + 124, 12);
      const type = String.fromCharCode(bytes[offset + 156] || 0);
      const dataStart = offset + 512;

      if ((type === "\0" || type === "0") && IMAGE_EXT.test(fullName)) {
        if (dataStart + size > bytes.length) throw new Error("The TAR archive appears to be truncated.");
        const copy = bytes.slice(dataStart, dataStart + size);
        entries.push({
          name: fullName,
          async getBlob() {
            return new Blob([copy], { type: guessMime(fullName) });
          },
        });
      }
      offset = dataStart + Math.ceil(size / 512) * 512;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    return entries;
  },

  // After an import batch, look for standalone comics (new + pre-existing) that
  // share a detected series name, and offer to bundle each group in turn.
  async suggestBundles(importedIds) {
    if (!importedIds.length) return;
    const comics = await LongboxDB.getAllComics();
    const newKeys = new Set(
      comics.filter((c) => importedIds.includes(c.id) && c.seriesKey).map((c) => c.seriesKey),
    );
    const candidates = (await this.findSeriesGroups()).filter((g) => newKeys.has(g[0].seriesKey));
    for (const group of candidates) {
      await this.askToBundle(group);
    }
  },

  // Manual, on-demand scan across the whole library — catches comics that
  // were imported before naming detection worked, or that were declined
  // earlier and are now worth another look.
  async detectSeriesNow() {
    const candidates = await this.findSeriesGroups();
    if (!candidates.length) {
      Modal.actions("No series found", "Every comic in your library is either already bundled or doesn't share a detectable series name with another comic.", [
        { label: "OK", cls: "neutral" },
      ]);
      return;
    }
    for (const group of candidates) {
      await this.askToBundle(group);
    }
  },

  // Groups all standalone comics by seriesKey, returns only groups of 2+.
  // Comics imported before a parser fix may have a stale/null seriesKey saved
  // from the old logic, so this re-derives it live and backfills the DB.
  async findSeriesGroups() {
    const comics = await LongboxDB.getAllComics();
    const standalone = comics.filter((c) => !c.collectionId);
    const groups = {};
    for (const c of standalone) {
      let key = c.seriesKey;
      if (!key) {
        const info = parseSeriesInfo(c.title);
        key = info.seriesKey;
        if (key) {
          await LongboxDB.updateComic(c.id, { seriesKey: key, issueNumber: c.issueNumber ?? info.issueNumber });
          c.seriesKey = key;
        }
      }
      if (!key) continue;
      (groups[key] = groups[key] || []).push(c);
    }
    return Object.values(groups).filter((g) => g.length >= 2);
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
