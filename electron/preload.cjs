const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lifeLibrary", Object.freeze({
  scan: () => ipcRenderer.invoke("library:scan"),
  preview: (relativePath) => ipcRenderer.invoke("library:preview", relativePath),
  thumbnail: (relativePath) => ipcRenderer.invoke("library:thumbnail", relativePath),
  open: (relativePath) => ipcRenderer.invoke("library:open", relativePath),
  reveal: (relativePath) => ipcRenderer.invoke("library:reveal", relativePath),
  rename: (relativePath, newName) => ipcRenderer.invoke("library:rename", relativePath, newName),
  delete: (relativePath) => ipcRenderer.invoke("library:delete", relativePath),
  analyze: (relativePath) => ipcRenderer.invoke("library:analyze", relativePath),
  visualize: (relativePath) => ipcRenderer.invoke("library:visualize", relativePath),
  recycleList: () => ipcRenderer.invoke("library:recycle-list"),
  recycleRestore: (id) => ipcRenderer.invoke("library:recycle-restore", id),
  recyclePurge: (id) => ipcRenderer.invoke("library:recycle-purge", id),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  chooseVault: () => ipcRenderer.invoke("settings:choose-vault"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  testProvider: (settings) => ipcRenderer.invoke("settings:test", settings),
  platform: process.platform,
}));
