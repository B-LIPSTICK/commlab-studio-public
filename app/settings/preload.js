const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("api", {
  settingsGet: () => invoke("settings:get"),
  settingsSet: (settings) => invoke("settings:set", settings),
  settingsTestEngine: (payload) => invoke("settings:testEngine", payload),
  settingsReset: () => invoke("settings:reset"),
  settingsChooseDirectory: () => invoke("settings:chooseDirectory"),
  settingsChooseEngine: () => invoke("settings:chooseEngine"),
  settingsOpenDataDir: () => invoke("settings:openDataDir"),
  settingsOpenLogs: () => invoke("settings:openLogs"),
  nativeStatus: () => invoke("native:status"),
  checkEnvironment: () => invoke("environment:check"),
  checkUpdate: () => invoke("update:check"),
  applyUpdate: () => invoke("update:apply"),
  openExternal: (url) => invoke("shell:open", url),
  openLab: () => invoke("lab:open"),
});