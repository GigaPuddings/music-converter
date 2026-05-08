const { contextBridge, ipcRenderer, webUtils } = require("electron");

const droppedPathListeners = new Set();

function decodeFileUri(uri) {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") return "";
    const pathname = decodeURIComponent(url.pathname);
    if (process.platform === "win32" && /^\/[A-Za-z]:/.test(pathname)) {
      return pathname.slice(1).replace(/\//g, "\\");
    }
    return pathname;
  } catch (error) {
    return "";
  }
}

function extractDroppedPaths(dataTransfer) {
  const paths = [];
  const pushPath = (value) => {
    if (value && !paths.includes(value)) paths.push(value);
  };

  for (const file of Array.from(dataTransfer?.files || [])) {
    pushPath(file.path || webUtils.getPathForFile(file));
  }

  for (const item of Array.from(dataTransfer?.items || [])) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      pushPath(file?.path || (file ? webUtils.getPathForFile(file) : ""));
    }
  }

  const uriList = dataTransfer?.getData?.("text/uri-list") || "";
  for (const line of uriList.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) pushPath(decodeFileUri(trimmed));
  }

  return paths;
}

window.addEventListener(
  "drop",
  (event) => {
    const paths = extractDroppedPaths(event.dataTransfer);
    if (paths.length) {
      for (const listener of droppedPathListeners) {
        listener(paths);
      }
    }
  },
  true,
);

contextBridge.exposeInMainWorld("musicConverter", {
  getDefaults: () => ipcRenderer.invoke("app:get-defaults"),
  classifyPaths: (paths) => ipcRenderer.invoke("paths:classify", paths),
  getDroppedPaths: async (files) =>
    Array.from(files || [])
      .map((file) => file.path || webUtils.getPathForFile(file))
      .filter(Boolean),
  onDroppedPaths: (callback) => {
    droppedPathListeners.add(callback);
    return () => droppedPathListeners.delete(callback);
  },
  selectFiles: () => ipcRenderer.invoke("files:select"),
  importFolder: () => ipcRenderer.invoke("folder:import"),
  selectOutputFolder: () => ipcRenderer.invoke("folder:select-output"),
  startConversion: (payload) => ipcRenderer.invoke("conversion:start", payload),
  cancelConversion: (id) => ipcRenderer.invoke("conversion:cancel", id),
  showItem: (filePath) => ipcRenderer.invoke("shell:show-item", filePath),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  hideWindow: () => ipcRenderer.invoke("window:hide"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  onConversionUpdate: (callback) => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on("conversion:update", listener);
    return () => ipcRenderer.removeListener("conversion:update", listener);
  },
});
