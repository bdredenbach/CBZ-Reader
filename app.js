// app.js — bootstrap, routing between library and reader

const LongboxApp = {
  init() {
    Library.init();
    Reader.init();

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch((err) => {
          console.warn("Service worker registration failed:", err);
        });
      });
    }
  },

  async openReader(comicId) {
    document.getElementById("library-view").classList.remove("active");
    document.getElementById("reader-view").classList.add("active");
    await Reader.open(comicId);
  },

  closeReader() {
    document.getElementById("reader-view").classList.remove("active");
    document.getElementById("library-view").classList.add("active");
    Library.refresh();
  },
};

window.LongboxApp = LongboxApp;
document.addEventListener("DOMContentLoaded", () => LongboxApp.init());
