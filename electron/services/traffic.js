const fs = require('fs')
const path = require('path')
const http = require('http')
const { getConfigDir, getCachedConfig, getSyncthingHome } = require('./config')
const { fetchFrpsAPI } = require('./frps-api')

// ========== 常量 ==========
const HISTORY_FILE = () => path.join(getConfigDir(), 'traffic-history.json')
const POLL_INTERVAL = 30 * 1000      // 30 秒采集一次
const SAVE_INTERVAL = 5 * 60 * 1000  // 5 分钟保存一次
const MAX_DAILY_RECORDS = 365        // 保留一年

// ========== 模块状态 ==========
let state = null
let pollTimer = null
let saveTimer = null
let configReady = false              // frps 凭证是否已就绪
let consecutiveFailures = 0          // 连续失败计数
let syncthingApiKey = null           // Syncthing API Key

// ========== 工具函数 ==========

function getTodayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function createEmptyState() {
  return {
    version: 1,
    lastKnownDate: getTodayStr(),
    // frps 隧道流量
    lastPollIn: 0,
    lastPollOut: 0,
    sessionTotalIn: 0,
    sessionTotalOut: 0,
    // Syncthing 同步流量
    lastSyncthingIn: 0,
    lastSyncthingOut: 0,
    sessionSyncthingIn: 0,
    sessionSyncthingOut: 0,
    // 累计
    totalTrafficIn: 0,
    totalTrafficOut: 0,
    lastSaved: new Date().toISOString(),
    dailyRecords: [],
  }
}

function loadState() {
  const filePath = HISTORY_FILE()
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && parsed.version === 1 && Array.isArray(parsed.dailyRecords)) {
        // 兼容旧版 state（补充新字段）
        if (parsed.lastSyncthingIn === undefined) parsed.lastSyncthingIn = 0
        if (parsed.lastSyncthingOut === undefined) parsed.lastSyncthingOut = 0
        if (parsed.sessionSyncthingIn === undefined) parsed.sessionSyncthingIn = 0
        if (parsed.sessionSyncthingOut === undefined) parsed.sessionSyncthingOut = 0
        return parsed
      }
    } catch (e) {
      console.error('[traffic] 加载流量数据失败，将重新创建:', e.message)
    }
  }
  return createEmptyState()
}

function saveState() {
  const filePath = HISTORY_FILE()
  state.lastSaved = new Date().toISOString()
  try {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8')
  } catch (e) {
    console.error('[traffic] 保存流量数据失败:', e.message)
  }
}

function getDateRange(startDate, endDate) {
  const dates = []
  const current = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  while (current < end) {
    const d = current
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    current.setDate(current.getDate() + 1)
  }
  return dates
}

function archiveDay(dateStr, inBytes, outBytes) {
  const existing = state.dailyRecords.findIndex(r => r.date === dateStr)
  if (existing !== -1) {
    state.dailyRecords[existing].in = Math.max(state.dailyRecords[existing].in, inBytes)
    state.dailyRecords[existing].out = Math.max(state.dailyRecords[existing].out, outBytes)
  } else {
    state.dailyRecords.push({ date: dateStr, in: inBytes, out: outBytes })
  }
  state.dailyRecords.sort((a, b) => b.date.localeCompare(a.date))
  if (state.dailyRecords.length > MAX_DAILY_RECORDS) {
    state.dailyRecords = state.dailyRecords.slice(0, MAX_DAILY_RECORDS)
  }
}

function handleDateChange() {
  const today = getTodayStr()
  if (state.lastKnownDate === today) return

  console.log(`[traffic] 检测到日期跳变: ${state.lastKnownDate} -> ${today}`)

  // 合并所有来源的当天数据
  const dayIn = state.sessionTotalIn + state.sessionSyncthingIn
  const dayOut = state.sessionTotalOut + state.sessionSyncthingOut

  if (dayIn > 0 || dayOut > 0) {
    archiveDay(state.lastKnownDate, dayIn, dayOut)
    state.totalTrafficIn += dayIn
    state.totalTrafficOut += dayOut
  }

  // 填充中间空白天数
  const missedDates = getDateRange(state.lastKnownDate, today)
  for (const d of missedDates) {
    archiveDay(d, 0, 0)
  }

  // 重置当天累计
  state.sessionTotalIn = 0
  state.sessionTotalOut = 0
  state.lastPollIn = 0
  state.lastPollOut = 0
  state.sessionSyncthingIn = 0
  state.sessionSyncthingOut = 0
  state.lastSyncthingIn = 0
  state.lastSyncthingOut = 0
  state.lastKnownDate = today
}

// ========== Syncthing API ==========

function loadSyncthingApiKey() {
  if (syncthingApiKey) return syncthingApiKey
  const homeDir = getSyncthingHome()
  const configPath = path.join(homeDir, 'config.xml')
  if (!fs.existsSync(configPath)) return null
  try {
    const xml = fs.readFileSync(configPath, 'utf8')
    const match = xml.match(/<apikey>([^<]+)<\/apikey>/)
    if (match) {
      syncthingApiKey = match[1]
      return syncthingApiKey
    }
  } catch { /* ignore */ }
  return null
}

function fetchSyncthingTraffic() {
  return new Promise((resolve) => {
    const apiKey = loadSyncthingApiKey()
    if (!apiKey) {
      resolve(null)
      return
    }

    const options = {
      hostname: '127.0.0.1',
      port: 8384,
      path: '/rest/system/connections',
      method: 'GET',
      headers: { 'X-API-Key': apiKey },
      timeout: 5000,
    }

    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (parsed && parsed.total) {
            resolve({
              inBytes: parsed.total.inBytesTotal || 0,
              outBytes: parsed.total.outBytesTotal || 0,
            })
          } else {
            resolve(null)
          }
        } catch {
          resolve(null)
        }
      })
    })

    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.end()
  })
}

// ========== 核心采集逻辑 ==========

async function fetchFrpsTraffic() {
  const config = getCachedConfig()
  if (!config.serverWebUser || !config.serverWebPassword) {
    if (consecutiveFailures === 0) {
      console.warn('[traffic] frps 凭证未就绪，跳过 frps 采集')
    }
    return null
  }

  if (!configReady) {
    configReady = true
    console.log('[traffic] frps 凭证已就绪')
  }

  try {
    const data = await fetchFrpsAPI('/api/proxy/tcp')
    if (!data || !data.proxies) {
      return null
    }

    let todayIn = 0
    let todayOut = 0
    for (const p of data.proxies) {
      todayIn += p.todayTrafficIn || 0
      todayOut += p.todayTrafficOut || 0
    }
    return { todayIn, todayOut }
  } catch (e) {
    consecutiveFailures++
    if (consecutiveFailures <= 3 || consecutiveFailures % 10 === 0) {
      console.error(`[traffic] frps 采集失败 (第${consecutiveFailures}次): ${e.message}`)
    }
    return null
  }
}

function calcDelta(current, last) {
  if (current >= last) return current - last
  // 计数器重置（服务重启/重连）
  return current
}

async function poll() {
  // 并发采集两个数据源
  const [frpsTraffic, syncthingTraffic] = await Promise.all([
    fetchFrpsTraffic(),
    fetchSyncthingTraffic(),
  ])

  // 至少一个数据源有数据才继续
  const hasData = frpsTraffic || syncthingTraffic
  if (!hasData) return

  // 恢复计数
  if (consecutiveFailures > 0) {
    console.log(`[traffic] 采集恢复正常（之前连续失败 ${consecutiveFailures} 次）`)
    consecutiveFailures = 0
  }

  handleDateChange()

  // 累加 frps 隧道流量 delta
  if (frpsTraffic) {
    state.sessionTotalIn += calcDelta(frpsTraffic.todayIn, state.lastPollIn)
    state.sessionTotalOut += calcDelta(frpsTraffic.todayOut, state.lastPollOut)
    state.lastPollIn = frpsTraffic.todayIn
    state.lastPollOut = frpsTraffic.todayOut
  }

  // 累加 Syncthing 同步流量 delta
  if (syncthingTraffic) {
    state.sessionSyncthingIn += calcDelta(syncthingTraffic.inBytes, state.lastSyncthingIn)
    state.sessionSyncthingOut += calcDelta(syncthingTraffic.outBytes, state.lastSyncthingOut)
    state.lastSyncthingIn = syncthingTraffic.inBytes
    state.lastSyncthingOut = syncthingTraffic.outBytes
  }

  state.lastKnownDate = getTodayStr()

  // 采集成功后立即保存，数据丢失窗口从 5 分钟降至 30 秒
  saveState()
}

// ========== 公共 API ==========

function start() {
  state = loadState()
  loadSyncthingApiKey()
  handleDateChange()

  poll()
  pollTimer = setInterval(poll, POLL_INTERVAL)
  saveTimer = setInterval(saveState, SAVE_INTERVAL)

  console.log('[traffic] 流量采集服务已启动（frps 隧道 + Syncthing 同步）')
}

function stop() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (saveTimer) {
    clearInterval(saveTimer)
    saveTimer = null
  }

  if (state) {
    const today = getTodayStr()
    const dayIn = state.sessionTotalIn + state.sessionSyncthingIn
    const dayOut = state.sessionTotalOut + state.sessionSyncthingOut
    if (dayIn > 0 || dayOut > 0) {
      archiveDay(today, dayIn, dayOut)
    }
    saveState()
    console.log('[traffic] 流量数据已保存')
  }
}

function getStats() {
  if (!state) {
    return { todayIn: 0, todayOut: 0, totalIn: 0, totalOut: 0, todayDate: getTodayStr(), dailyRecords: [] }
  }

  // 合并两个数据源
  const todayIn = state.sessionTotalIn + state.sessionSyncthingIn
  const todayOut = state.sessionTotalOut + state.sessionSyncthingOut

  return {
    todayIn,
    todayOut,
    totalIn: state.totalTrafficIn + todayIn,
    totalOut: state.totalTrafficOut + todayOut,
    todayDate: getTodayStr(),
    dailyRecords: state.dailyRecords,
  }
}

function getHistory(days = 30) {
  if (!state) return []

  const today = getTodayStr()
  const records = [...state.dailyRecords]

  // 合并当天实时数据
  const todayIn = state.sessionTotalIn + state.sessionSyncthingIn
  const todayOut = state.sessionTotalOut + state.sessionSyncthingOut
  const todayRecord = records.find(r => r.date === today)
  if (todayRecord) {
    todayRecord.in = Math.max(todayRecord.in, todayIn)
    todayRecord.out = Math.max(todayRecord.out, todayOut)
  } else if (todayIn > 0 || todayOut > 0) {
    records.push({ date: today, in: todayIn, out: todayOut })
  }

  records.sort((a, b) => b.date.localeCompare(a.date))
  return records.slice(0, days)
}

module.exports = { start, stop, getStats, getHistory }
