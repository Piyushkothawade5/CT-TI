// Minimal preload. The web app is fully client-side and talks to Supabase
// directly over HTTPS, so no privileged bridge is required. We only expose a
// tiny, read-only hint that the app is running inside the desktop shell.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isElectron: true,
  platform: process.platform,
});
