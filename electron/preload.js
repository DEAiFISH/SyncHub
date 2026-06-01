const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // frpc
  getFrpcStatus: () => ipcRenderer.invoke('frpc:status'),
  restartFrpc: () => ipcRenderer.invoke('frpc:restart'),
  getFrpcConfig: () => ipcRenderer.invoke('frpc:config'),
  saveFrpcConfig: (config) => ipcRenderer.invoke('frpc:saveConfig', config),

  // frps server
  getFrpsProxies: () => ipcRenderer.invoke('frps:proxies'),
  getFrpsServerInfo: () => ipcRenderer.invoke('frps:serverInfo'),

  // 流量统计
  getTrafficStats: () => ipcRenderer.invoke('traffic:stats'),
  getTrafficHistory: (days) => ipcRenderer.invoke('traffic:history', days),

  // syncthing
  getSyncthingStatus: () => ipcRenderer.invoke('syncthing:status'),
  restartSyncthing: () => ipcRenderer.invoke('syncthing:restart'),
  getSyncthingInfo: () => ipcRenderer.invoke('syncthing:info'),

  // logs
  getLogs: () => ipcRenderer.invoke('logs'),
  exportLogs: () => ipcRenderer.invoke('logs:export'),

  // window
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  // settings
  setAutoStart: (enable) => ipcRenderer.invoke('settings:autoStart', enable),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  updateSyncDir: (newDir) => ipcRenderer.invoke('settings:updateSyncDir', newDir),
})
