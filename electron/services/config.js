const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const https = require('https')
const { app } = require('electron')

const APP_NAME = 'SyncHub'
const DATA_DIR_NAME = 'SyncHub'

// 服务器域名（从环境变量读取）
const SERVER_DOMAIN = process.env.SERVER_DOMAIN || ''

// frpc.exe v0.69.0 SHA256 校验值
const FRPC_SHA256 = 'F8467A4F8D57CDE5BA808A764B528147ACD81DB0955E51BEE80FDE0FEA0E5243'

// 获取带 hostname 前缀的默认代理列表（避免多设备代理名冲突）
function getDefaultProxies() {
  const hostname = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-')
  return [
    { name: `${hostname}-rdp`, type: 'tcp', localIP: '127.0.0.1', localPort: 3389, remotePort: 6000 },
    { name: `${hostname}-ssh`, type: 'tcp', localIP: '127.0.0.1', localPort: 22, remotePort: 6001 },
  ]
}

// 内嵌公开配置（不含敏感凭证，凭证通过 .env 环境变量注入）
const EMBEDDED_CONFIG = {
  serverAddr: process.env.SERVER_ADDR || '',
  serverPort: parseInt(process.env.SERVER_PORT) || 7000,
  authToken: process.env.AUTH_TOKEN || '',
  serverWebUser: process.env.FRPS_DASHBOARD_USER || '',
  serverWebPassword: process.env.FRPS_DASHBOARD_PASSWORD || '',
  serverSyncthingDeviceId: process.env.SYNCTHING_SERVER_DEVICE_ID || '',
  get defaultProxies() { return getDefaultProxies() },
}

// 敏感凭证缓存（从远程接口获取后缓存到本地）
let _secureConfig = null

function getSecureConfigPath() {
  return path.join(getConfigDir(), '.secure_config.json')
}

// 从服务器 HTTPS 接口获取敏感凭证
function fetchSecureConfig() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SERVER_DOMAIN,
      path: '/synchub-config',
      method: 'GET',
      timeout: 10000,
      rejectUnauthorized: false,
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          const config = JSON.parse(data)
          if (config.authToken && config.serverWebUser && config.serverWebPassword) {
            resolve(config)
          } else {
            reject(new Error('配置格式不正确'))
          }
        } catch (e) {
          reject(new Error('解析配置失败: ' + e.message))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('获取配置超时')) })
    req.end()
  })
}

// 获取完整配置（合并公开配置和敏感凭证）
async function getFullConfig() {
  // .env 中凭证完整时直接使用，不再依赖远程接口
  if (EMBEDDED_CONFIG.authToken && EMBEDDED_CONFIG.serverWebUser && EMBEDDED_CONFIG.serverWebPassword) {
    _secureConfig = {}
    console.log('[SyncHub] 凭证已就绪（来自 .env）')
    return { ...EMBEDDED_CONFIG }
  }

  if (_secureConfig) {
    return { ...EMBEDDED_CONFIG, ..._secureConfig }
  }

  // 优先从本地缓存读取
  const cachePath = getSecureConfigPath()
  if (fs.existsSync(cachePath)) {
    try {
      _secureConfig = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
      return { ...EMBEDDED_CONFIG, ..._secureConfig }
    } catch { /* ignore */ }
  }

  // 本地无缓存，从服务器获取
  try {
    _secureConfig = await fetchSecureConfig()
    // 缓存到本地
    const configDir = getConfigDir()
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true })
    }
    fs.writeFileSync(cachePath, JSON.stringify(_secureConfig), 'utf8')
    return { ...EMBEDDED_CONFIG, ..._secureConfig }
  } catch (err) {
    console.error('[SyncHub] 获取安全配置失败:', err.message)
    // 如果有旧缓存，勉强使用
    if (_secureConfig) {
      return { ...EMBEDDED_CONFIG, ..._secureConfig }
    }
    // 无缓存也无网络，返回基本配置（功能受限）
    return { ...EMBEDDED_CONFIG }
  }
}

// 同步获取缓存的配置（用于非 async 上下文）
function getCachedConfig() {
  if (_secureConfig) {
    return { ...EMBEDDED_CONFIG, ..._secureConfig }
  }
  const cachePath = getSecureConfigPath()
  if (fs.existsSync(cachePath)) {
    try {
      _secureConfig = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
      return { ...EMBEDDED_CONFIG, ..._secureConfig }
    } catch { /* ignore */ }
  }
  return { ...EMBEDDED_CONFIG }
}

function getDataDir() {
  return path.join(os.homedir(), DATA_DIR_NAME)
}

function getConfigDir() {
  return path.join(getDataDir(), 'config')
}

function getSyncDir() {
  const settings = getSettings()
  return settings.syncDir || path.join(getDataDir(), 'data')
}

function getSyncthingHome() {
  return path.join(getDataDir(), 'syncthing')
}

function getFrpcConfigPath() {
  return path.join(getConfigDir(), 'frpc.toml')
}

function getSetupMarkerPath() {
  return path.join(getConfigDir(), '.setup_done')
}

function isSetupDone() {
  return fs.existsSync(getSetupMarkerPath())
}

function getSettingsPath() {
  return path.join(getConfigDir(), 'settings.json')
}

function getSettings() {
  const filePath = getSettingsPath()
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    }
  } catch { /* ignore */ }
  return {}
}

function saveSettings(settings) {
  const filePath = getSettingsPath()
  const configDir = getConfigDir()
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8')
}

function getBinaryDir() {
  const isDev = !app || app.isPackaged === false
  if (isDev) {
    // __dirname = <project>/electron/services/ → 上两级到项目根目录
    const projectRoot = path.resolve(__dirname, '..', '..')
    return path.join(projectRoot, 'resources', 'bin')
  }
  return path.join(process.resourcesPath, 'bin')
}

// 用户数据目录下的 bin 目录（运行时实际使用的路径）
function getUserBinDir() {
  return path.join(getDataDir(), 'bin')
}

function getFrpcBinary() {
  const platform = process.platform
  const binDir = getUserBinDir()
  if (platform === 'win32') {
    return path.join(binDir, 'frpc.exe')
  }
  return path.join(binDir, 'frpc')
}

function getSyncthingBinary() {
  const platform = process.platform
  const binDir = getUserBinDir()
  if (platform === 'win32') {
    return path.join(binDir, 'syncthing.exe')
  }
  return path.join(binDir, 'syncthing')
}

// 从安装目录 resources 复制二进制文件到用户数据目录
// 如果用户目录已有文件则跳过，如果缺失则尝试从 resources 恢复
function ensureBinaries() {
  const userBinDir = getUserBinDir()
  const isDev = !app || app.isPackaged === false

  if (!fs.existsSync(userBinDir)) {
    fs.mkdirSync(userBinDir, { recursive: true })
  }

  const platform = process.platform
  const files = platform === 'win32'
    ? ['frpc.exe', 'syncthing.exe']
    : ['frpc', 'syncthing']

  const srcSubDir = platform === 'win32' ? 'win' : 'mac'

  for (const file of files) {
    const destPath = path.join(userBinDir, file)
    if (fs.existsSync(destPath)) continue

    // 尝试从 resources 复制
    let srcPath
    if (isDev) {
      const projectRoot = path.resolve(__dirname, '..', '..')
      srcPath = path.join(projectRoot, 'resources', 'bin', srcSubDir, file)
    } else {
      srcPath = path.join(process.resourcesPath, 'bin', srcSubDir, file)
    }

    if (fs.existsSync(srcPath)) {
      try {
        fs.copyFileSync(srcPath, destPath)
        console.log(`[SyncHub] 已复制 ${file} 到用户数据目录`)
      } catch (err) {
        console.error(`[SyncHub] 复制 ${file} 失败: ${err.message}`)
      }
    }
  }
}

// 添加 Windows Defender 排除项（弹出 UAC 提示请求管理员权限）
function addDefenderExclusion(dirPath) {
  if (process.platform !== 'win32') return false
  const { execSync } = require('child_process')
  const escaped = dirPath.replace(/'/g, "''")
  const script = `Add-MpPreference -ExclusionPath '${escaped}'\n`
  // 使用随机文件名避免路径可预测
  const scriptPath = path.join(os.tmpdir(), `synchub_${crypto.randomUUID()}.ps1`)
  fs.writeFileSync(scriptPath, script, 'utf8')
  try {
    execSync(
      `powershell.exe -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-ExecutionPolicy Bypass -File \\"${scriptPath}\\"'"`,
      { windowsHide: true, timeout: 60000 }
    )
    return true
  } catch {
    return false
  } finally {
    try { fs.unlinkSync(scriptPath) } catch {}
  }
}

// 校验文件 SHA256
function verifyFileHash(filePath, expectedHash) {
  if (!fs.existsSync(filePath)) return false
  const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
  return hash.toUpperCase() === expectedHash.toUpperCase()
}

// 从网络下载 frpc.exe 到指定目录（HTTPS 优先，含 SHA256 校验）
function downloadFrpc(destDir) {
  if (process.platform !== 'win32') return false
  const { execSync } = require('child_process')
  const version = '0.69.0'

  // 阶段1: 直接下载 frpc.exe（HTTPS 域名优先，无需解压）
  const exeMirrors = [
    `https://${SERVER_DOMAIN}/synchub/frpc.exe`,
    `http://${EMBEDDED_CONFIG.serverAddr}:8081/frpc.exe`,
  ]
  const escapedDir = destDir.replace(/'/g, "''")
  const exeUrlsVar = exeMirrors.map(u => `'${u}'`).join(', ')
  const directScript = `
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$urls = @(${exeUrlsVar})
$destDir = '${escapedDir}'
if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
$destFile = Join-Path $destDir 'frpc.exe'
foreach ($url in $urls) {
  try {
    Invoke-WebRequest -Uri $url -OutFile $destFile -UseBasicParsing -TimeoutSec 60
    if (Test-Path $destFile -and (Get-Item $destFile).Length -gt 100KB) {
      Write-Host 'OK'
      exit 0
    }
    Remove-Item $destFile -Force -ErrorAction SilentlyContinue
    Write-Host "Downloaded file too small or missing"
  } catch {
    Write-Host "Mirror failed: $($_.Exception.Message)"
  }
}
Write-Host 'DIRECT_FAILED'
`
  // 使用随机文件名
  const directScriptPath = path.join(os.tmpdir(), `synchub_${crypto.randomUUID()}.ps1`)
  fs.writeFileSync(directScriptPath, directScript, 'utf8')
  try {
    const result = execSync(`powershell.exe -ExecutionPolicy Bypass -File "${directScriptPath}"`, {
      windowsHide: true,
      timeout: 120000,
    })
    const output = result.toString().trim()
    if (output === 'OK' || output.endsWith('\nOK')) {
      // SHA256 校验
      const destFile = path.join(destDir, 'frpc.exe')
      if (verifyFileHash(destFile, FRPC_SHA256)) {
        console.log('[SyncHub] frpc.exe 下载成功，SHA256 校验通过')
        return true
      } else {
        console.error('[SyncHub] frpc.exe SHA256 校验失败，文件可能被篡改')
        try { fs.unlinkSync(destFile) } catch {}
        return false
      }
    }
    console.log(`[SyncHub] 直接下载失败: ${output}`)
  } catch (err) {
    console.log(`[SyncHub] 直接下载失败: ${err.message}`)
  } finally {
    try { fs.unlinkSync(directScriptPath) } catch {}
  }

  // 阶段2: 下载 zip 包并解压（在 destDir 内操作，避免 Defender 扫描）
  const githubPath = `fatedier/frp/releases/download/v${version}/frp_${version}_windows_amd64.zip`
  const zipMirrors = [
    `https://${SERVER_DOMAIN}/synchub/frp_${version}_windows_amd64.zip`,
    `https://ghfast.top/${githubPath}`,
    `https://gh-proxy.com/${githubPath}`,
    `https://github.com/${githubPath}`,
  ]
  const zipUrlsVar = zipMirrors.map(u => `'${u}'`).join(', ')
  const zipScript = `
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$urls = @(${zipUrlsVar})
$destDir = '${escapedDir}'
if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
$tempFile = Join-Path $destDir '_frp_download.zip'
$extractDir = Join-Path $destDir '_frp_extract'
$downloaded = $false
foreach ($url in $urls) {
  try {
    Invoke-WebRequest -Uri $url -OutFile $tempFile -UseBasicParsing -TimeoutSec 60
    $downloaded = $true
    break
  } catch {
    Write-Host "Mirror failed: $($_.Exception.Message)"
  }
}
if (-not $downloaded) {
  Write-Host 'ALL_MIRRORS_FAILED'
  exit 1
}
try {
  if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
  Expand-Archive -Path $tempFile -DestinationPath $extractDir -Force
  $exe = Get-ChildItem -Path $extractDir -Filter 'frpc.exe' -Recurse | Select-Object -First 1
  if ($exe) {
    Move-Item $exe.FullName -Destination (Join-Path $destDir 'frpc.exe') -Force
    Write-Host 'OK'
  } else {
    Write-Host 'EXE_NOT_FOUND'
  }
} catch {
  Write-Host $_.Exception.Message
} finally {
  Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
  Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
}
`
  const zipScriptPath = path.join(os.tmpdir(), `synchub_${crypto.randomUUID()}.ps1`)
  fs.writeFileSync(zipScriptPath, zipScript, 'utf8')
  try {
    const result = execSync(`powershell.exe -ExecutionPolicy Bypass -File "${zipScriptPath}"`, {
      windowsHide: true,
      timeout: 300000,
    })
    const output = result.toString().trim()
    if (output.includes('Mirror failed')) {
      console.log(`[SyncHub] downloadFrpc zip: ${output}`)
    }
    if (output === 'OK' || output.endsWith('\nOK')) {
      // SHA256 校验
      const destFile = path.join(destDir, 'frpc.exe')
      if (verifyFileHash(destFile, FRPC_SHA256)) {
        console.log('[SyncHub] frpc.exe zip 解压成功，SHA256 校验通过')
        return true
      } else {
        console.error('[SyncHub] frpc.exe SHA256 校验失败，文件可能被篡改')
        try { fs.unlinkSync(destFile) } catch {}
        return false
      }
    }
    return false
  } catch (err) {
    console.error(`[SyncHub] downloadFrpc zip failed: ${err.message}`)
    return false
  } finally {
    try { fs.unlinkSync(zipScriptPath) } catch {}
  }
}

// frpc.toml 模板生成
function generateFrpcToml(config = {}) {
  const cfg = { ...getCachedConfig(), ...config }
  const proxies = cfg.proxies || cfg.defaultProxies

  let toml = `serverAddr = "${cfg.serverAddr}"\n`
  toml += `serverPort = ${cfg.serverPort}\n`
  toml += `auth.method = "token"\n`
  toml += `auth.token = "${cfg.authToken}"\n`

  for (const p of proxies) {
    toml += `\n[[proxies]]\n`
    toml += `name = "${p.name}"\n`
    toml += `type = "${p.type}"\n`
    toml += `localIP = "${p.localIP}"\n`
    toml += `localPort = ${p.localPort}\n`
    toml += `remotePort = ${p.remotePort}\n`
  }

  return toml
}

// 首次配置流程
function runFirstTimeSetup() {
  const dataDir = getDataDir()
  const configDir = getConfigDir()
  const syncDir = getSyncDir()
  const syncthingHome = getSyncthingHome()

  // 创建目录
  for (const dir of [dataDir, configDir, syncDir, syncthingHome]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  // 生成 frpc.toml
  const frpcToml = generateFrpcToml()
  fs.writeFileSync(getFrpcConfigPath(), frpcToml, 'utf8')

  // 标记配置完成
  fs.writeFileSync(getSetupMarkerPath(), new Date().toISOString(), 'utf8')

  return { dataDir, configDir, syncDir, syncthingHome }
}

// 读取当前 frpc 配置
function readFrpcConfig() {
  const configPath = getFrpcConfigPath()
  if (!fs.existsSync(configPath)) {
    return getCachedConfig()
  }
  const content = fs.readFileSync(configPath, 'utf8')
  const config = { ...getCachedConfig() }

  const addrMatch = content.match(/serverAddr\s*=\s*"([^"]+)"/)
  if (addrMatch) config.serverAddr = addrMatch[1]

  const portMatch = content.match(/serverPort\s*=\s*(\d+)/)
  if (portMatch) config.serverPort = parseInt(portMatch[1])

  const tokenMatch = content.match(/auth\.token\s*=\s*"([^"]+)"/)
  if (tokenMatch) config.authToken = tokenMatch[1]

  // 解析 proxies
  config.proxies = []
  const proxyBlocks = content.split(/\[\[proxies\]\]/).slice(1)
  for (const block of proxyBlocks) {
    const proxy = {}
    const nameMatch = block.match(/name\s*=\s*"([^"]+)"/)
    const typeMatch = block.match(/type\s*=\s*"([^"]+)"/)
    const localIPMatch = block.match(/localIP\s*=\s*"([^"]+)"/)
    const localPortMatch = block.match(/localPort\s*=\s*(\d+)/)
    const remotePortMatch = block.match(/remotePort\s*=\s*(\d+)/)
    if (nameMatch) proxy.name = nameMatch[1]
    if (typeMatch) proxy.type = typeMatch[1]
    if (localIPMatch) proxy.localIP = localIPMatch[1]
    if (localPortMatch) proxy.localPort = parseInt(localPortMatch[1])
    if (remotePortMatch) proxy.remotePort = parseInt(remotePortMatch[1])
    if (proxy.name) config.proxies.push(proxy)
  }

  return config
}

// 保存 frpc 配置
function writeFrpcConfig(config) {
  const toml = generateFrpcToml(config)
  fs.writeFileSync(getFrpcConfigPath(), toml, 'utf8')
}

module.exports = {
  EMBEDDED_CONFIG,
  SERVER_DOMAIN,
  getDataDir,
  getConfigDir,
  getSyncDir,
  getSyncthingHome,
  getFrpcConfigPath,
  getSetupMarkerPath,
  isSetupDone,
  getSettings,
  saveSettings,
  getFrpcBinary,
  getSyncthingBinary,
  ensureBinaries,
  addDefenderExclusion,
  downloadFrpc,
  runFirstTimeSetup,
  readFrpcConfig,
  writeFrpcConfig,
  generateFrpcToml,
  getFullConfig,
  getCachedConfig,
  verifyFileHash,
  FRPC_SHA256,
}
