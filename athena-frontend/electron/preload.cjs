const { contextBridge, ipcRenderer } = require("electron");

const api = {
  setFullScreen: () => ipcRenderer.invoke("full-screen"),
  getRemainingTime: () => ipcRenderer.invoke("get-time"),
  startTest: (durationMinutes = 60) => ipcRenderer.invoke("start-test", durationMinutes),
  showExamRules: () => ipcRenderer.invoke("show-rules"),
  savePhoto: (arrayBuffer) => ipcRenderer.invoke("save-photo", arrayBuffer),
  getDesktopSources: () => ipcRenderer.invoke("get-desktop-sources"),
  startExam: (userId, name) => ipcRenderer.invoke("start-exam", userId, name),
};

// Expose under both electronAPI and electron
contextBridge.exposeInMainWorld("electronAPI", api);
contextBridge.exposeInMainWorld("electron", api);
