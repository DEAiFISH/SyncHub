// dotenv 必须在其他模块之前加载，确保 process.env 已注入
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron')
const {
  isSetupDone,
  runFirstTimeSetup,
  readFrpcConfig,
  writeFrpcConfig,
  getSettings,
  saveSettings,
  getSyncDir,
  ensureBinaries,
  getFullConfig,
} = require('./services/config')
const frpc = require('./services/frpc')
const syncthing = require('./services/syncthing')
const frpsApi = require('./services/frps-api')
const traffic = require('./services/traffic')
const updater = require('./services/updater')

let mainWindow = null
let tray = null
let isQuitting = false

const isDev = !app.isPackaged

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1a1b2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
    icon: getIconPath(),
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // 关闭窗口 → 隐藏到托盘
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
}

function getIconPath() {
  if (isDev) {
    return path.join(__dirname, '..', 'resources', 'icon.png')
  }
  // 打包后：ICO 在 resources 目录
  return path.join(process.resourcesPath, 'icon.ico')
}

function createTrayIcon() {
  // Windows 托盘需要 ICO，优先使用 ICO
  const icoPath = isDev
    ? path.join(__dirname, '..', 'resources', 'icon.ico')
    : path.join(process.resourcesPath, 'icon.ico')

  const pngPath = isDev
    ? path.join(__dirname, '..', 'resources', 'icon.png')
    : path.join(process.resourcesPath, 'icon.png')

  // 尝试加载 ICO（Windows 托盘最佳格式）
  const fs = require('fs')
  if (fs.existsSync(icoPath)) {
    try {
      return nativeImage.createFromPath(icoPath)
    } catch { /* fall through */ }
  }

  // 回退到 PNG，缩放到 16x16 适合托盘
  if (fs.existsSync(pngPath)) {
    try {
      const img = nativeImage.createFromPath(pngPath)
      if (!img.isEmpty()) {
        return img.resize({ width: 16, height: 16 })
      }
    } catch { /* fall through */ }
  }

  // 最终回退：创建一个简单的 16x16 蓝色圆点图标
  return createFallbackIcon()
}

function createFallbackIcon() {
  // 生成一个 16x16 的简单图标（蓝色圆点在透明背景上）
  const size = 16
  const img = nativeImage.createEmpty()
  // 使用 1x1 PNG 作为最小回退
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFElEQVQ4y2N' +
    'kwAT/GYYBYwYDAKLuAf8LSXNHAAAAABJRU5ErkJggg==',
    'base64'
  )
  return nativeImage.createFromBuffer(png)
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '打开 SyncHub', click: () => mainWindow && mainWindow.show() },
    { type: 'separator' },
    { label: `FRP: ${statusLabel(frpc.getStatus())}`, enabled: false },
    { label: `Syncthing: ${statusLabel(syncthing.getStatus())}`, enabled: false },
    { type: 'separator' },
    { label: '重启 FRP', click: () => frpc.restart() },
    { label: '重启 Syncthing', click: () => syncthing.restart() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        frpc.stop()
        syncthing.stop()
        if (tray && !tray.isDestroyed()) tray.destroy()
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy()
        app.quit()
      },
    },
  ])
}

function createTray() {
  const icon = createTrayIcon()
  tray = new Tray(icon)

  tray.setToolTip('SyncHub - 文件同步管理')
  tray.setContextMenu(buildTrayMenu())
  tray.on('double-click', () => mainWindow && mainWindow.show())

  // 定期更新托盘菜单
  setInterval(() => {
    if (tray && !tray.isDestroyed()) {
      tray.setContextMenu(buildTrayMenu())
    }
  }, 5000)
}

function statusLabel(s) {
  return { running: '运行中', stopped: '已停止', unknown: '未知', error: '异常' }[s] || s
}

// IPC handlers
function setupIPC() {
  ipcMain.handle('frpc:status', () => {
    try {
      return { processStatus: frpc.getStatus(), lastError: frpc.getLastError() }
    } catch (err) {
      console.error('[IPC] frpc:status error:', err.message)
      return { processStatus: 'error', lastError: err.message }
    }
  })
  ipcMain.handle('frpc:restart', () => {
    try { frpc.restart() } catch (err) { console.error('[IPC] frpc:restart error:', err.message) }
  })
  ipcMain.handle('frpc:config', () => {
    try { return readFrpcConfig() } catch (err) { console.error('[IPC] frpc:config error:', err.message); return {} }
  })
  ipcMain.handle('frpc:saveConfig', (_, config) => {
    try {
      writeFrpcConfig(config)
      frpc.restart()
    } catch (err) { console.error('[IPC] frpc:saveConfig error:', err.message) }
  })

  ipcMain.handle('frps:proxies', async () => {
    try { return await frpsApi.getProxyList() } catch (err) { console.error('[IPC] frps:proxies error:', err.message); return { error: err.message } }
  })
  ipcMain.handle('frps:serverInfo', async () => {
    try { return await frpsApi.getServerInfo() } catch (err) { console.error('[IPC] frps:serverInfo error:', err.message); return { error: err.message } }
  })

  // 流量统计
  ipcMain.handle('traffic:stats', () => {
    try { return traffic.getStats() } catch (err) { console.error('[IPC] traffic:stats error:', err.message); return {} }
  })
  ipcMain.handle('traffic:history', (_, days) => {
    try { return traffic.getHistory(days || 30) } catch (err) { console.error('[IPC] traffic:history error:', err.message); return [] }
  })

  ipcMain.handle('syncthing:status', () => {
    try {
      return { processStatus: syncthing.getStatus(), lastError: syncthing.getLastError() }
    } catch (err) {
      console.error('[IPC] syncthing:status error:', err.message)
      return { processStatus: 'error', lastError: err.message }
    }
  })
  ipcMain.handle('syncthing:restart', () => {
    try { syncthing.restart() } catch (err) { console.error('[IPC] syncthing:restart error:', err.message) }
  })
  ipcMain.handle('syncthing:info', async () => {
    try { return await syncthing.getInfo() } catch (err) { console.error('[IPC] syncthing:info error:', err.message); return {} }
  })

  // 设置
  ipcMain.handle('settings:get', () => {
    try { return getSettings() } catch (err) { console.error('[IPC] settings:get error:', err.message); return {} }
  })
  ipcMain.handle('settings:save', (_, settings) => {
    try { saveSettings(settings) } catch (err) { console.error('[IPC] settings:save error:', err.message) }
  })
  ipcMain.handle('settings:updateSyncDir', (_, newDir) => {
    try {
      const settings = getSettings()
      settings.syncDir = newDir
      saveSettings(settings)
      const { getSyncthingHome } = require('./services/config')
      const homeDir = getSyncthingHome()
      const syncthingModule = require('./services/syncthing')
      const configPath = require('path').join(homeDir, 'config.xml')
      const fs = require('fs')
      if (fs.existsSync(configPath)) {
        const syncDirPath = newDir.replace(/\\/g, '/')
        let xml = fs.readFileSync(configPath, 'utf8')
        xml = xml.replace(
          /(<folder[^>]*?)path="[^"]*"/,
          `$1path="${syncDirPath}"`
        )
        fs.writeFileSync(configPath, xml, 'utf8')
        if (!fs.existsSync(newDir)) {
          fs.mkdirSync(newDir, { recursive: true })
        }
      }
      syncthingModule.restart()
    } catch (err) { console.error('[IPC] settings:updateSyncDir error:', err.message) }
  })

  ipcMain.handle('logs', () => {
    try { return frpc.getLogs() + '\n' + syncthing.getLogs() } catch (err) { console.error('[IPC] logs error:', err.message); return '' }
  })
  ipcMain.handle('logs:export', () => {
    try {
      const { dialog } = require('electron')
      const fs = require('fs')
      const date = new Date().toISOString().slice(0, 10)
      const result = dialog.showSaveDialogSync(mainWindow, {
        title: '导出 SyncHub 日志',
        defaultPath: `SyncHub-log-${date}.txt`,
        filters: [{ name: '文本文件', extensions: ['txt'] }],
      })
      if (result) {
        const content = frpc.getLogs() + '\n\n=== Syncthing ===\n' + syncthing.getLogs()
        fs.writeFileSync(result, content, 'utf8')
        return result
      }
      return null
    } catch (err) { console.error('[IPC] logs:export error:', err.message); return null }
  })

  // 窗口最小化
  ipcMain.handle('window:minimize', () => { try { mainWindow && mainWindow.minimize() } catch {} })
  // 关闭按钮 → 隐藏到托盘
  ipcMain.handle('window:close', () => { try { mainWindow && mainWindow.hide() } catch {} })

  ipcMain.handle('settings:autoStart', (_, enable) => {
    try {
      app.setLoginItemSettings({ openAtLogin: enable, path: app.getPath('exe') })
    } catch (err) { console.error('[IPC] settings:autoStart error:', err.message) }
  })

  // 更新
  ipcMain.handle('updater:check', () => {
    try { updater.checkForUpdate(0) } catch (err) { console.error('[IPC] updater:check error:', err.message) }
  })
  ipcMain.handle('updater:install', () => {
    try { updater.quitAndInstall() } catch (err) { console.error('[IPC] updater:install error:', err.message) }
  })
  ipcMain.handle('updater:status', () => {
    try { return updater.getStatus() } catch (err) { console.error('[IPC] updater:status error:', err.message); return {} }
  })
}

// App lifecycle
app.whenReady().then(async () => {
  if (!isSetupDone()) {
    console.log('[SyncHub] 首次启动，执行自动配置...')
    try {
      runFirstTimeSetup()
    } catch (err) {
      console.error('[SyncHub] 首次配置失败:', err.message)
    }
  }

  // 从服务器获取安全配置（敏感凭证通过 HTTPS 获取）
  console.log('[SyncHub] 获取安全配置...')
  let configSuccess = false
  try {
    await getFullConfig()
    configSuccess = true
  } catch (err) {
    console.error('[SyncHub] 获取安全配置失败:', err.message)
  }

  // 确保二进制文件存在于用户数据目录（从安装目录复制）
  console.log('[SyncHub] 检查二进制文件...')
  try {
    ensureBinaries()
  } catch (err) {
    console.error('[SyncHub] 检查二进制文件失败:', err.message)
  }

  setupIPC()
  createWindow()
  createTray()

  // 初始化自动更新
  updater.init(mainWindow)
  updater.checkForUpdate()

  try {
    console.log('[SyncHub] 启动 frpc...')
    frpc.start()
  } catch (err) {
    console.error('[SyncHub] 启动 frpc 失败:', err.message)
  }

  try {
    console.log('[SyncHub] 启动 syncthing...')
    syncthing.start()
  } catch (err) {
    console.error('[SyncHub] 启动 syncthing 失败:', err.message)
  }

  try {
    if (configSuccess) {
      console.log('[SyncHub] 启动流量采集...')
      traffic.start()
    } else {
      console.warn('[SyncHub] 安全配置未获取成功，延迟启动流量采集...')
      // 延迟重试：等凭证就绪后再启动
      const retryStart = () => {
        const config = require('./services/config').getCachedConfig()
        if (config.serverWebUser && config.serverWebPassword) {
          console.log('[SyncHub] 凭证已就绪，启动流量采集')
          traffic.start()
        } else {
          console.warn('[SyncHub] 凭证仍未就绪，60 秒后重试...')
          setTimeout(retryStart, 60000)
        }
      }
      setTimeout(retryStart, 10000)
    }
  } catch (err) {
    console.error('[SyncHub] 启动流量采集失败:', err.message)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow.show()
    }
  })
})

app.on('before-quit', () => {
  frpc.stop()
  syncthing.stop()
  traffic.stop()
})

app.on('window-all-closed', () => {
  // 托盘模式：不退出，保持后台运行
  // 只有从托盘菜单点击"退出"才会真正退出
})

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}
