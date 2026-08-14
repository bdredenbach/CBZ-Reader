// library.js — import CBZ files, render the library grid

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif)$/i;

const Library = {
  el: null,
  gridEl: null,
  emptyEl: null,
  countEl: null,
  progressEl: null,
  progressText: null,

  init() {
    this.el = document.getElementById("library-view");
    this.gridEl = document.getElementById("comic-grid");
    this.emptyEl = document.getElementById("empty-state");
    this.countEl = document.getElementById("lib-count");
    this.progressEl = document.getElementById("import-progress");
    this.progressText = document.getElementById("import-progress-text");

    document.getElementById("import-input").addEventListener("change", (e) => {
      this.handleFiles(e.target.files);
      e.target.value = "";
    });

    this.refresh();
  },

  async refresh() {
    const comics = await LongboxDB.getAllComics();
    this.countEl.textContent = comics.length
      ? `${comics.length} book${comics.length === 1 ? "" : "s"}`
      : "";
    this.emptyEl.style.display = comics.length ? "none" : "block";
    this.gridEl.style.display = comics.length ? "grid" : "none";
    this.gridEl.innerHTML = "";
    for (const comic of comics) {
      this.gridEl.appendChild(this.renderCard(comic));
    }
  },

  renderCard(comic) {
    const card = document.createElement("div");
    card.className = "comic-card";
    card.dataset.id = comic.id;

    const pct = comic.pageCount
      ? Math.round(((comic.lastPage || 0) / (comic.pageCount - 1)) * 100)
      : 0;

    card.innerHTML = `
      <div class="comic-cover">
        <img src="${comic.coverUrl}" alt="" loading="lazy" />
        <div class="comic-progress-bar"><div class="comic-progress-fill" style="width:${pct}%"></div></div>
        <button class="delete-x" title="Delete" aria-label="Delete comic">✕</button>
      </div>
      <div class="comic-title">${escapeHtml(comic.title)}</div>
    `;

    card.querySelector(".delete-x").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${comic.title}"? This can't be undone.`)) {
        await LongboxDB.deleteComic(comic.id);
        this.refresh();
      }
    });

    card.addEventListener("click", () => {
      window.LongboxApp.openReader(comic.id);
    });

    return card;
  },

  async handleFiles(fileList) {
    const files = Array.from(fileList).filter((f) => /\.cbz$/i.test(f.name) || /\.zip$/i.test(f.name));
    if (!files.length) {
      alert("Please choose a .cbz (or .zip) file.");
      return;
    }
    this.progressEl.classList.add("active");
    for (const file of files) {
      try {
        this.progressText.textContent = `Importing ${file.name}…`;
        await this.importCbz(file);
      } catch (err) {
        console.error(err);
        alert(`Couldn't import ${file.name}: ${err.message}`);
      }
    }
    this.progressEl.classList.remove("active");
    this.refresh();
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
      this.progressText.textContent = `Importing ${file.name}… (${i + 1}/${entries.length})`;
      const blob = await entries[i].async("blob");
      const typedBlob = blob.type ? blob : new Blob([blob], { type: guessMime(entries[i].name) });
      await LongboxDB.putPage(id, i, typedBlob);
      if (i === 0) {
        coverUrl = await blobToDataUrl(await makeThumbnail(typedBlob));
      }
    }

    const title = file.name.replace(/\.(cbz|zip)$/i, "");
    await LongboxDB.addComic({
      id,
      title,
      pageCount: entries.length,
      coverUrl,
      lastPage: 0,
      bookmarks: [],
      readMode: "single",
      addedAt: Date.now(),
    });
  },
};

function guessMime(name) {
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.gif$/i.test(name)) return "image/gif";
  if (/\.webp$/i.test(name)) return "image/webp";
  return "image/jpeg";
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
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
