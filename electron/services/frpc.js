const { spawn, execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const { getFrpcBinary, getFrpcConfigPath, ensureBinaries, addDefenderExclusion, downloadFrpc, getDataDir } = require('./config')

let frpcProcess = null
let status = 'stopped'
let logBuffer = []
let restartCount = 0
const MAX_RESTARTS = 5
const RESTART_INTERVAL = 5000
let restartTimer = null
let manualStop = false
let recoveryAttempted = false

function addLog(level, msg) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  logBuffer.push(`[${time}] [frpc:${level}] ${msg}`)
  if (logBuffer.length > 1000) logBuffer.shift()
}

function start() {
  if (frpcProcess && !frpcProcess.killed) {
    addLog('info', 'frpc 已在运行中，跳过启动')
    return
  }

  const binPath = getFrpcBinary()
  const configPath = getFrpcConfigPath()

  addLog('info', `二进制路径: ${binPath}`)
  addLog('info', `配置路径: ${configPath}`)

  // 检查二进制文件是否存在，缺失时尝试恢复
  if (!fs.existsSync(binPath)) {
    addLog('warn', 'frpc 二进制文件缺失，尝试从安装目录恢复...')
    ensureBinaries()
  }
  if (!fs.existsSync(binPath) && !recoveryAttempted) {
    recoveryAttempted = true
    // 安装目录的文件也被 Defender 删除了，尝试添加排除项后下载
    addLog('warn', '安装目录文件也缺失，可能是 Windows Defender 拦截')
    addLog('info', '正在请求添加 Defender 排除项（请允许 UAC 弹窗）...')
    const userBinDir = path.dirname(binPath)
    addDefenderExclusion(userBinDir)
    addLog('info', '正在从网络下载 frpc.exe（使用国内镜像）...')
    const downloaded = downloadFrpc(userBinDir)
    if (downloaded) {
      addLog('info', 'frpc.exe 已从网络下载恢复')
    } else {
      addLog('error', 'frpc.exe 下载失败，请检查网络连接')
    }
  }
  if (!fs.existsSync(binPath)) {
    status = 'error'
    addLog('error', `frpc 二进制文件不存在: ${binPath}`)
    addLog('error', '请手动操作:')
    addLog('error', '1. 打开 Windows 安全中心 → 病毒和威胁防护 → 管理设置 → 排除项')
    addLog('error', `2. 添加排除项: ${path.dirname(binPath)}`)
    addLog('error', '3. 从 https://github.com/fatedier/frp/releases 下载 frpc.exe 放入上述目录')
    addLog('error', '4. 重启 SyncHub')
    scheduleRestart()
    return
  }

  // 检查配置文件是否存在
  if (!fs.existsSync(configPath)) {
    status = 'error'
    addLog('error', `frpc 配置文件不存在: ${configPath}`)
    return
  }

  try {
    // 使用 execFile 避免 shell，更可靠
    frpcProcess = execFile(binPath, ['-c', configPath], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })

    if (!frpcProcess.pid) {
      status = 'error'
      addLog('error', 'frpc 进程启动失败，无法获取 PID')
      scheduleRestart()
      return
    }

    status = 'running'
    restartCount = 0
    addLog('info', `frpc 已启动 (PID: ${frpcProcess.pid})`)

    frpcProcess.stdout.on('data', (data) => {
      const msg = data.toString().trim()
      if (msg) {
        msg.split('\n').forEach((line) => {
          if (line.trim()) addLog('info', line.trim())
        })
      }
    })

    frpcProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim()
      if (msg) {
        msg.split('\n').forEach((line) => {
          if (line.trim()) addLog('error', line.trim())
        })
      }
    })

    frpcProcess.on('close', (code, signal) => {
      addLog('info', `进程退出 (code=${code}, signal=${signal})`)
      status = 'stopped'
      frpcProcess = null
      if (!manualStop) {
        scheduleRestart()
      } else {
        manualStop = false
      }
    })

    frpcProcess.on('error', (err) => {
      addLog('error', `spawn 错误: ${err.code} - ${err.message}`)
      if (err.code === 'UNKNOWN') {
        addLog('error', '可能原因: 文件被 Windows Defender 拦截，或文件损坏')
      }
      status = 'error'
      frpcProcess = null
      scheduleRestart()
    })
  } catch (err) {
    status = 'error'
    addLog('error', `启动异常: ${err.message}`)
    scheduleRestart()
  }
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

function stop() {
  manualStop = true
  if (frpcProcess && !frpcProcess.killed) {
    addLog('info', '正在停止 frpc...')
    try {
      if (process.platform === 'win32') {
        const { execSync } = require('child_process')
        execSync(`taskkill /pid ${frpcProcess.pid} /T /F`, { windowsHide: true })
      } else {
        frpcProcess.kill('SIGKILL')
      }
    } catch (e) {
      try { frpcProcess.kill() } catch {}
    }
    frpcProcess = null
    status = 'stopped'
    addLog('info', 'frpc 已停止')
  }
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
}

function restart() {
  recoveryAttempted = false
  restartCount = 0
  stop()
  setTimeout(() => start(), 1000)
}

function getStatus() {
  return status
}

function getLastError() {
  // 从日志末尾查找最近的错误信息
  const errorLines = logBuffer.filter(l => l.includes('[frpc:error]'))
  if (errorLines.length === 0) return null
  // 返回最后一条错误（去掉时间前缀）
  const last = errorLines[errorLines.length - 1]
  return last.replace(/^\[.*?\] \[frpc:error\] /, '')
}

function getLogs() {
  return logBuffer.join('\n')
}

module.exports = { start, stop, restart, getStatus, getLastError, getLogs }
