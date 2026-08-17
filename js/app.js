// app.js — bootstrap, routing between library and reader

const LongboxApp = {
  deferredInstallPrompt: null,

  init() {
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      this.deferredInstallPrompt = event;
      this.updateInstallButton();
    });

    window.addEventListener("appinstalled", () => {
      this.deferredInstallPrompt = null;
      this.updateInstallButton();
    });
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

  updateInstallButton() {
    const btn = document.getElementById("install-app-btn");
    if (!btn) return;
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    btn.style.display = standalone ? "none" : "";
    btn.textContent = this.deferredInstallPrompt ? "Install" : "Install";
    btn.title = this.deferredInstallPrompt
      ? "Install Longbox on this device"
      : "Install Longbox from your browser menu";
  },

  async installPWA() {
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    if (standalone) return;

    if (!this.deferredInstallPrompt) {
      Modal.actions(
        "Install Longbox",
        "If your browser does not show the install prompt automatically, open the browser menu and choose “Install app” or “Add to Home screen.”",
        [{ label: "Close", cls: "subtle" }]
      );
      return;
    }

    const promptEvent = this.deferredInstallPrompt;
    this.deferredInstallPrompt = null;
    promptEvent.prompt();
    await promptEvent.userChoice.catch(() => null);
    this.updateInstallButton();
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
