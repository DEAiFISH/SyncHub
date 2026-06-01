const { spawn, execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const {
  getSyncthingBinary,
  getSyncthingHome,
  getSyncDir,
  isSetupDone,
  EMBEDDED_CONFIG,
  ensureBinaries,
  SERVER_DOMAIN,
  getCachedConfig,
} = require('./config')

let syncthingProcess = null
let status = 'stopped'
let logBuffer = []
let localApiKey = null
let restartCount = 0
const MAX_RESTARTS = 5
const RESTART_INTERVAL = 10000
let restartTimer = null
let manualStop = false

function addLog(level, msg) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  logBuffer.push(`[${time}] [syncthing:${level}] ${msg}`)
  if (logBuffer.length > 1000) logBuffer.shift()
}

const net = require('net')

function checkPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => { server.close(); resolve(false) })
    server.listen(port, '127.0.0.1')
  })
}

function scheduleRestart() {
  if (restartTimer) return
  if (restartCount >= MAX_RESTARTS) {
    addLog('error', `已达到最大重试次数 (${MAX_RESTARTS})，停止重试`)
    return
  }
  restartCount++
  addLog('info', `将在 ${RESTART_INTERVAL / 1000} 秒后重试... (${restartCount}/${MAX_RESTARTS})`)
  restartTimer = setTimeout(() => {
    restartTimer = null
    start()
  }, RESTART_INTERVAL)
}

async function start() {
  if (syncthingProcess && !syncthingProcess.killed) {
    addLog('info', 'syncthing 已在运行中，跳过启动')
    return
  }

  const binPath = getSyncthingBinary()
  const homeDir = getSyncthingHome()

  addLog('info', `二进制路径: ${binPath}`)
  addLog('info', `配置目录: ${homeDir}`)

  // 检查 lock 文件，避免多实例冲突
  const lockFile = path.join(homeDir, 'panicked')
  const certFile = path.join(homeDir, 'cert.pem')
  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile)
    addLog('info', '已清除 lock 文件')
  }

  // 如果 syncthing 已在运行（其他实例），先检测端口
  const portInUse = await checkPortInUse(8384)
  if (portInUse) {
    addLog('warn', '端口 8384 已被占用，可能存在其他 Syncthing 实例')
    status = 'running'
    localApiKey = extractApiKey(homeDir)
    return
  }

  // 确保 syncthing 配置目录存在
  if (!fs.existsSync(homeDir)) {
    fs.mkdirSync(homeDir, { recursive: true })
  }

  // 首次启动需要生成配置
  const configPath = path.join(homeDir, 'config.xml')
  if (!fs.existsSync(configPath)) {
    try {
      addLog('info', '首次启动，正在生成配置...')
      execSync(`"${binPath}" generate --home="${homeDir}"`, {
        windowsHide: true,
        timeout: 30000,
      })
      addLog('info', '配置已生成')
      patchConfig(homeDir)
    } catch (err) {
      addLog('error', `配置生成失败: ${err.message}`)
    }
  }

  // 检查二进制文件，缺失时尝试从安装目录恢复
  if (!fs.existsSync(binPath)) {
    addLog('warn', `syncthing 二进制文件缺失，尝试恢复...`)
    ensureBinaries()
  }
  if (!fs.existsSync(binPath)) {
    status = 'error'
    addLog('error', `syncthing 二进制文件不存在: ${binPath}`)
    return
  }

  // 提取本地 API key
  localApiKey = extractApiKey(homeDir)
  addLog('info', `API Key: ${localApiKey || '(未找到)'}`)

  try {
    syncthingProcess = spawn(binPath, ['serve', `--home=${homeDir}`, '--no-browser'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (!syncthingProcess.pid) {
      status = 'error'
      addLog('error', 'syncthing 进程启动失败，无法获取 PID')
      return
    }

    status = 'running'
    restartCount = 0
    addLog('info', `syncthing 已启动 (PID: ${syncthingProcess.pid})`)

    // 启动后延迟注册到服务器（等待 Syncthing 完全就绪）
    setTimeout(() => registerToServer(), 5000)

    syncthingProcess.stdout.on('data', (data) => {
      const msg = data.toString().trim()
      if (msg) {
        msg.split('\n').forEach((line) => {
          if (line.trim()) addLog('info', line.trim())
        })
      }
    })

    syncthingProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim()
      if (msg) {
        msg.split('\n').forEach((line) => {
          if (line.trim()) addLog('error', line.trim())
        })
      }
    })

    syncthingProcess.on('close', (code, signal) => {
      addLog('info', `进程退出 (code=${code}, signal=${signal})`)
      status = 'stopped'
      syncthingProcess = null
      if (!manualStop) {
        scheduleRestart()
      } else {
        manualStop = false
      }
    })

    syncthingProcess.on('error', (err) => {
      addLog('error', `spawn 错误: ${err.code} - ${err.message}`)
      status = 'error'
      syncthingProcess = null
      scheduleRestart()
    })
  } catch (err) {
    status = 'error'
    addLog('error', `启动异常: ${err.message}`)
    scheduleRestart()
  }
}

function stop() {
  addLog('info', '正在停止 syncthing...')
  manualStop = true

  if (syncthingProcess && !syncthingProcess.killed) {
    try {
      if (process.platform === 'win32') {
        // Syncthing v2 会 fork 子进程，先尝试杀进程树，再用 /IM 兜底杀所有实例
        const { execSync } = require('child_process')
        try {
          execSync(`taskkill /pid ${syncthingProcess.pid} /T /F`, { windowsHide: true })
        } catch (e) {
          addLog('warn', `taskkill /pid 失败: ${e.message}`)
        }
        // 按进程名杀死所有 syncthing.exe（兜底，确保子进程也被杀）
        try {
          execSync('taskkill /IM syncthing.exe /F', { windowsHide: true })
        } catch (e) {
          // 如果没有 syncthing 进程，会报错，忽略
        }
      } else {
        syncthingProcess.kill('SIGKILL')
      }
    } catch (e) {
      try { syncthingProcess.kill() } catch {}
    }
    syncthingProcess = null
    status = 'stopped'
    addLog('info', 'syncthing 已停止')
  } else if (process.platform === 'win32') {
    // 即使没有跟踪到进程，也尝试按名杀死（可能被其他方式启动的）
    try {
      const { execSync } = require('child_process')
      execSync('taskkill /IM syncthing.exe /F', { windowsHide: true })
      addLog('info', '已强制终止所有 syncthing 进程')
    } catch (e) {
      // 没有运行中的 syncthing 进程
    }
    status = 'stopped'
  }

  // 清除可能的重启定时器
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
    addLog('info', '已取消计划中的重启')
  }
}

function restart() {
  stop()
  setTimeout(() => start(), 2000)
}

function getStatus() {
  return status
}

function getLastError() {
  const errorLines = logBuffer.filter(l => l.includes('[syncthing:error]'))
  if (errorLines.length === 0) return null
  const last = errorLines[errorLines.length - 1]
  return last.replace(/^\[.*?\] \[syncthing:error\] /, '')
}

function getLogs() {
  return logBuffer.join('\n')
}

// 修改生成的 config.xml：设置 GUI 地址、添加远程设备、创建文件夹
function patchConfig(homeDir) {
  const configPath = path.join(homeDir, 'config.xml')
  if (!fs.existsSync(configPath)) return

  let xml = fs.readFileSync(configPath, 'utf8')

  // GUI 设为无密码（应用自己管理），或保留默认
  // 设监听地址为 127.0.0.1:8384
  xml = xml.replace(
    /<address>127\.0\.0\.1:8384<\/address>/,
    '<address>127.0.0.1:8384</address>'
  )

  // 添加远程设备
  const remoteDeviceXml = `
    <device id="${EMBEDDED_CONFIG.serverSyncthingDeviceId}" name="aliyun-server" compression="metadata" introducer="false" skipIntroductionRemovals="false" introducedBy="">
        <address>tcp://${EMBEDDED_CONFIG.serverAddr}:22000</address>
        <paused>false</paused>
        <autoAcceptFolders>false</autoAcceptFolders>
        <maxSendKbps>0</maxSendKbps>
        <maxRecvKbps>0</maxRecvKbps>
        <maxRequestKiB>0</maxRequestKiB>
        <untrusted>false</untrusted>
        <remoteGUIPort>0</remoteGUIPort>
        <numConnections>0</numConnections>
    </device>`

  // 在 </gui> 后插入远程设备
  xml = xml.replace('</gui>', '</gui>' + remoteDeviceXml)

  // 修改默认文件夹指向同步目录
  const syncDir = getSyncDir().replace(/\\/g, '/')
  xml = xml.replace(
    /(<folder[^>]*?)path="[^"]*"/,
    `$1path="${syncDir}"`
  )
  // 更新文件夹标签
  xml = xml.replace(
    /(<folder[^>]*?)label="[^"]*"/,
    '$1label="SyncHub"'
  )

  // 在 folder 内添加远程设备共享（确保双向同步）
  const remoteDeviceInFolder = `\n        <device id="${EMBEDDED_CONFIG.serverSyncthingDeviceId}" introducedBy=""/>`
  xml = xml.replace(
    /(<folder[^>]*?>[\s\S]*?)(<\/folder>)/,
    `$1${remoteDeviceInFolder}\n    $2`
  )

  // 确保同步目录存在
  if (!fs.existsSync(syncDir)) {
    fs.mkdirSync(syncDir, { recursive: true })
  }

  fs.writeFileSync(configPath, xml, 'utf8')
  logBuffer.push('[syncthing] 配置已更新')
}

function extractApiKey(homeDir) {
  const configPath = path.join(homeDir, 'config.xml')
  if (!fs.existsSync(configPath)) return null
  const xml = fs.readFileSync(configPath, 'utf8')
  const match = xml.match(/<apikey>([^<]+)<\/apikey>/)
  return match ? match[1] : null
}

// 调用 Syncthing REST API
function apiCall(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const apiKey = localApiKey
    if (!apiKey) {
      reject(new Error('API key not available'))
      return
    }

    const options = {
      hostname: '127.0.0.1',
      port: 8384,
      path: endpoint,
      method: method,
      headers: {
        'X-API-Key': apiKey,
      },
    }

    if (body) {
      const data = JSON.stringify(body)
      options.headers['Content-Type'] = 'application/json'
      options.headers['Content-Length'] = Buffer.byteLength(data)
    }

    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          resolve(data)
        }
      })
    })

    req.on('error', reject)

    if (body) {
      req.write(JSON.stringify(body))
    }
    req.end()
  })
}

// 调用服务器 Syncthing REST API（通过 HTTPS nginx 反向代理）
function serverApiCall(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const config = getCachedConfig()
    const options = {
      hostname: SERVER_DOMAIN,
      path: `/syncthing${endpoint}`,
      method: method,
      rejectUnauthorized: false,
      headers: {
        'X-API-Key': config.serverSyncthingApiKey || '',
      },
    }

    if (body) {
      const data = JSON.stringify(body)
      options.headers['Content-Type'] = 'application/json'
      options.headers['Content-Length'] = Buffer.byteLength(data)
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          resolve(data)
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(10000, () => {
      req.destroy(new Error('服务器 API 超时'))
    })

    if (body) {
      req.write(JSON.stringify(body))
    }
    req.end()
  })
}

// 提取本机设备 ID（通过本地 Syncthing REST API，比解析 XML 更可靠）
async function getLocalDeviceId() {
  try {
    const result = await apiCall('GET', '/rest/system/status')
    return result.myID || null
  } catch {
    return null
  }
}

// 将本机设备注册到服务器 Syncthing，并共享文件夹
async function registerToServer() {
  const localDeviceId = await getLocalDeviceId()
  if (!localDeviceId) {
    addLog('warn', '无法获取本机设备 ID，跳过服务器注册')
    return
  }

  addLog('info', `本机设备 ID: ${localDeviceId}`)
  addLog('info', '正在注册本机设备到服务器 Syncthing...')

  try {
    // 1. 检查服务器是否已有本机设备
    const serverDevices = await serverApiCall('GET', '/rest/config/devices')
    const alreadyRegistered = serverDevices.some((d) => d.deviceID === localDeviceId)

    if (alreadyRegistered) {
      addLog('info', '本机设备已在服务器中注册，跳过')
    } else {
      // 2. 添加本机设备到服务器
      await serverApiCall('POST', '/rest/config/devices', {
        deviceID: localDeviceId,
        name: `SyncHub-${require('os').hostname()}`,
        addresses: ['dynamic'],
        compression: 'metadata',
        introducer: false,
        skippedIntroductionRemovals: false,
        introducedBy: '',
        autoAcceptFolders: false,
        paused: false,
      })
      addLog('info', '本机设备已注册到服务器 Syncthing')
    }

    // 3. 将本机设备添加到服务器的默认文件夹共享
    const serverFolders = await serverApiCall('GET', '/rest/config/folders')
    if (serverFolders && serverFolders.length > 0) {
      const folder = serverFolders[0]
      const alreadyShared = folder.devices && folder.devices.some(
        (d) => d.deviceID === localDeviceId
      )
      if (!alreadyShared) {
        folder.devices = folder.devices || []
        folder.devices.push({ deviceID: localDeviceId, introducedBy: '' })
        await serverApiCall('PUT', `/rest/config/folders/${folder.id}`, folder)
        addLog('info', `已将本机设备添加到服务器文件夹 "${folder.label || folder.id}" 的共享列表`)
      } else {
        addLog('info', '本机设备已在服务器文件夹共享列表中')
      }
    }
  } catch (err) {
    addLog('warn', `服务器注册失败: ${err.message}（可能是网络不通，不影响本地使用）`)
  }
}

// 获取同步信息
async function getInfo() {
  try {
    const config = await apiCall('GET', '/rest/config')
    const deviceId = await apiCall('GET', '/rest/system/status')

    let folderPath = '-'
    let completion = '-'
    let globalFiles = null
    let remoteDevice = '-'

    if (config.folders && config.folders.length > 0) {
      folderPath = config.folders[0].path

      // 获取文件夹状态
      try {
        const folderStatus = await apiCall('GET', `/rest/db/status?folder=${config.folders[0].id}`)
        globalFiles = folderStatus.globalFiles
      } catch { /* ignore */ }

      // 获取远程设备完成度
      if (config.devices) {
        const remoteDevices = config.devices.filter(
          (d) => d.deviceID !== deviceId.myID
        )
        if (remoteDevices.length > 0) {
          remoteDevice = remoteDevices[0].name || remoteDevices[0].deviceID.substring(0, 10) + '...'
          try {
            const comp = await apiCall(
              'GET',
              `/rest/db/completion?device=${remoteDevices[0].deviceID}&folder=${config.folders[0].id}`
            )
            completion = comp.completion
          } catch { /* ignore */ }
        }
      }
    }

    return {
      folderPath,
      completion,
      globalFiles,
      remoteDevice,
      deviceId: deviceId.myID || '-',
    }
  } catch {
    return {
      folderPath: '-',
      completion: '-',
      globalFiles: null,
      remoteDevice: '-',
      deviceId: '-',
    }
  }
}

module.exports = { start, stop, restart, getStatus, getLastError, getLogs, getInfo, apiCall, registerToServer }
