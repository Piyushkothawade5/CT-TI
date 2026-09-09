const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");

const isDev = !app.isPackaged && process.env.ELECTRON_START_URL;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#eef2f7",
    show: false,
    autoHideMenuBar: true,
    title: "CT Technical Instruction",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Allow the file:// renderer to call the Supabase REST/Auth API and the
      // Cloudflare drawing-upload endpoint directly over HTTPS.
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  if (isDev) {
    // `npm run electron:dev` points this at the Vite dev server.
    mainWindow.loadURL(process.env.ELECTRON_START_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // Packaged: load the static build produced by `vite build`.
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  // Open external links (e.g. downloads, docs) in the user's real browser
  // instead of a frameless Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Keep a single running instance; focus the existing window on relaunch.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
