const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("api", {
  devices: () => ipcRenderer.invoke("workbench:devices"),
  params: () => ipcRenderer.invoke("workbench:params"),
  experiments: () => ipcRenderer.invoke("workbench:experiments"),
  save: (data) => ipcRenderer.invoke("workbench:save", data),
  saveSvg: (payload) => ipcRenderer.invoke("workbench:saveSvg", payload),
  load: () => ipcRenderer.invoke("workbench:load"),
  runGraph: (graph) => ipcRenderer.invoke("workbench:run", graph),
  openLab: (graph) => ipcRenderer.invoke("lab:open", graph),
});
