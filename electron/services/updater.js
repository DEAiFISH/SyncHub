const { autoUpdater } = require('electron-updater')
const { app } = require('electron')

let mainWindow = null
let updateInfo = null       // { version, releaseNotes }
let downloadProgress = null // { percent, bytesPerSecond, transferred, total }
let updateDownloaded = false

function init(win) {
  mainWindow = win

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] 发现新版本: ${info.version}`)
    updateInfo = { version: info.version, releaseNotes: info.releaseNotes || '' }
    // 自动开始下载
    autoUpdater.downloadUpdate()
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] 当前已是最新版本')
    updateInfo = null
  })

  autoUpdater.on('download-progress', (progress) => {
    downloadProgress = {
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    }
    console.log(`[updater] 下载进度: ${downloadProgress.percent}%`)
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] 新版本已下载完成: ${info.version}`)
    updateDownloaded = true
    // 通知渲染进程
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:downloaded', { version: info.version })
    }
  })

  autoUpdater.on('error', (err) => {
    console.error(`[updater] 错误: ${err.message}`)
  })
}

function checkForUpdate(delay = 30000) {
  // 开发模式下跳过
  if (!app.isPackaged) {
    console.log('[updater] 开发模式，跳过更新检查')
    return
  }
  setTimeout(() => {
    console.log('[updater] 检查更新...')
    autoUpdater.checkForUpdates().catch((err) => {
      console.error(`[updater] 检查失败: ${err.message}`)
    })
  }, delay)
}

function quitAndInstall() {
  if (updateDownloaded) {
    autoUpdater.quitAndInstall()
  }
}

function getStatus() {
  return {
    updateInfo,
    downloadProgress,
    updateDownloaded,
    currentVersion: app.getVersion(),
  }
}

module.exports = { init, checkForUpdate, quitAndInstall, getStatus }
