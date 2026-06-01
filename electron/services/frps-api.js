const https = require('https')
const http = require('http')
const { getCachedConfig } = require('./config')

const FRPS_API_PORT = 7500

function fetchFrpsAPI(endpoint) {
  return new Promise((resolve, reject) => {
    const config = getCachedConfig()
    const options = {
      hostname: config.serverAddr,
      port: FRPS_API_PORT,
      path: endpoint,
      method: 'GET',
      headers: {
        'Authorization':
          'Basic ' + Buffer.from(config.serverWebUser + ':' + config.serverWebPassword).toString('base64'),
      },
      timeout: 10000,
    }

    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          console.error(`[frps-api] ${endpoint} 返回非成功状态码: ${res.statusCode}, body: ${data.substring(0, 200)}`)
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(data))
        } catch {
          console.error(`[frps-api] ${endpoint} JSON 解析失败: ${data.substring(0, 200)}`)
          reject(new Error('JSON 解析失败'))
        }
      })
    })

    req.on('error', (e) => {
      console.error(`[frps-api] ${endpoint} 请求失败: ${e.message}`)
      reject(e)
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.end()
  })
}

async function getProxyList() {
  try {
    const data = await fetchFrpsAPI('/api/proxy/tcp')
    return (data.proxies || []).map((p) => ({
      name: p.name,
      status: p.status,
      localIP: p.conf ? p.conf.localIP : '-',
      localPort: p.conf ? p.conf.localPort : '-',
      remotePort: p.conf ? p.conf.remotePort : '-',
      todayTrafficIn: formatBytes(p.todayTrafficIn || 0),
      todayTrafficOut: formatBytes(p.todayTrafficOut || 0),
      curConns: p.curConns || 0,
      lastStartTime: p.lastStartTime || '-',
    }))
  } catch (e) {
    return { error: e.message }
  }
}

async function getServerInfo() {
  try {
    const data = await fetchFrpsAPI('/api/serverinfo')
    // 获取代理列表用于汇总今日流量
    let todayTrafficIn = 0
    let todayTrafficOut = 0
    try {
      const proxyData = await fetchFrpsAPI('/api/proxy/tcp')
      if (proxyData.proxies) {
        for (const p of proxyData.proxies) {
          todayTrafficIn += p.todayTrafficIn || 0
          todayTrafficOut += p.todayTrafficOut || 0
        }
      }
    } catch { /* ignore */ }
    return {
      version: data.version,
      bindPort: data.bindPort,
      curConns: data.curConns,
      clientCounts: data.clientCounts,
      // 使用汇总的代理流量替代 serverinfo 中始终为 0 的 totalTraffic
      todayTrafficIn,
      todayTrafficOut,
    }
  } catch (e) {
    return { error: e.message }
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

module.exports = { getProxyList, getServerInfo, fetchFrpsAPI }
