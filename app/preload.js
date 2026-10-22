const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("api", {
  list: () => ipcRenderer.invoke("experiments:list"),
  read: (rel) => ipcRenderer.invoke("experiments:read", rel),
  coursepackStatus: () => ipcRenderer.invoke("coursepack:status"),
  coursepackImport: (sourcePath) => ipcRenderer.invoke("coursepack:import", sourcePath),
  coursepackClear: () => ipcRenderer.invoke("coursepack:clear"),
  md: (text) => ipcRenderer.invoke("md:render", text),
  openLab: () => ipcRenderer.invoke("lab:open"),
  runExperiment: (order, opts) => ipcRenderer.invoke("experiment:run", order, opts),
  cancelExperiment: (order) => ipcRenderer.invoke("experiment:cancel", order),
  onExperimentProgress: (cb) => {
    const listener = (_event, info) => cb(info);
    ipcRenderer.on("experiment:progress", listener);
    return () => ipcRenderer.removeListener("experiment:progress", listener);
  },
  openWorkbench: () => ipcRenderer.invoke("workbench:open"),
  saveFigure: (payload) => ipcRenderer.invoke("figure:save", payload),
  openTemplates: () => ipcRenderer.invoke("report:openFolder"),
  exportReport: (payload) => ipcRenderer.invoke("report:export", payload),
  openExternal: (url) => ipcRenderer.invoke("shell:open", url),
  checkEnvironment: () => ipcRenderer.invoke("environment:check"),
  openSettings: () => ipcRenderer.invoke("settings:open"),
  settingsGet: () => ipcRenderer.invoke("settings:get"),
  settingsSet: (settings) => ipcRenderer.invoke("settings:set", settings),
  settingsTestEngine: (payload) => ipcRenderer.invoke("settings:testEngine", payload),
  onSettingsAppearance: (cb) => {
    const listener = (_event, info) => cb(info);
    ipcRenderer.on("settings:appearance", listener);
    return () => ipcRenderer.removeListener("settings:appearance", listener);
  },
  nativeStatus: () => ipcRenderer.invoke("native:status"),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  applyUpdate: () => ipcRenderer.invoke("update:apply"),
  onUpdate: (cb) => ipcRenderer.on("update:available", (_e, info) => cb(info)),
});
