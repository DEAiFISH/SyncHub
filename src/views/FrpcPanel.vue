<template>
  <div class="frpc-panel">
    <div class="panel-header">
      <h2>FRP 隧道管理</h2>
      <button class="btn" :class="{ loading: refreshing }" @click="manualRefresh"><span class="spinner"></span>刷新</button>
    </div>

    <!-- 服务器信息 -->
    <div class="card" style="margin-bottom: 16px;">
      <div class="card-header">
        <span class="card-title">服务器状态</span>
        <span :class="['card-status', serverOnline ? 'running' : 'stopped']">
          {{ serverOnline ? '在线' : '离线' }}
        </span>
      </div>
      <div class="card-info">
        <div class="info-row">
          <span class="info-label">地址</span>
          <span class="info-value">{{ config.serverAddr }}:{{ config.serverPort }}</span>
        </div>
        <div class="info-row" v-if="serverInfo.version">
          <span class="info-label">版本</span>
          <span class="info-value">{{ serverInfo.version }}</span>
        </div>
        <div class="info-row" v-if="serverInfo.todayTrafficIn !== undefined">
          <span class="info-label">今日流量</span>
          <span class="info-value">↓ {{ formatBytes(serverInfo.todayTrafficIn) }} / ↑ {{ formatBytes(serverInfo.todayTrafficOut) }}</span>
        </div>
      </div>
    </div>

    <!-- 代理列表 -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">隧道列表</span>
      </div>
      <table class="proxy-table" v-if="!proxiesError">
        <thead>
          <tr>
            <th>名称</th>
            <th>状态</th>
            <th>本地端口</th>
            <th>远程端口</th>
            <th>连接数</th>
            <th>今日流量</th>
            <th>启动时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in proxies" :key="p.name">
            <td><strong>{{ p.name }}</strong></td>
            <td>
              <span :class="['status-badge', p.status]">{{ p.status === 'online' ? '在线' : '离线' }}</span>
            </td>
            <td>{{ p.localIP }}:{{ p.localPort }}</td>
            <td>{{ config.serverAddr }}:{{ p.remotePort }}</td>
            <td>{{ p.curConns }}</td>
            <td>↓ {{ p.todayTrafficIn }} / ↑ {{ p.todayTrafficOut }}</td>
            <td>{{ p.lastStartTime }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="proxiesError" class="error-msg">
        无法连接到 FRP 服务器: {{ proxiesError }}
      </div>
    </div>
  </div>
</template>

<script>
import { formatBytes } from '../utils/format'

export default {
  data() {
    return {
      proxies: [],
      proxiesError: null,
      serverInfo: {},
      serverOnline: false,
      config: {},
      refreshing: false,
      pollTimer: null,
    }
  },
  async mounted() {
    if (window.electronAPI) {
      this.config = await window.electronAPI.getFrpcConfig()
    }
    this.refresh()
    this.pollTimer = setInterval(() => this.refresh(), 5000)
  },
  beforeUnmount() {
    if (this.pollTimer) clearInterval(this.pollTimer)
  },
  methods: {
    async manualRefresh() {
      if (this.refreshing) return
      this.refreshing = true
      try {
        await this.refresh()
      } finally {
        setTimeout(() => { this.refreshing = false }, 1000)
      }
    },
    async refresh() {
      if (!window.electronAPI) return
      try {
        const proxyResult = await window.electronAPI.getFrpsProxies()
        if (proxyResult.error) {
          this.proxiesError = proxyResult.error
          this.proxies = []
          this.serverOnline = false
        } else {
          // 只显示当前配置中定义的代理，过滤掉服务器上的旧残留
          const myProxyNames = (this.config.proxies || []).map(p => p.name)
          this.proxies = proxyResult.filter(p => myProxyNames.includes(p.name))
          this.proxiesError = null
          this.serverOnline = true
        }
        const info = await window.electronAPI.getFrpsServerInfo()
        if (!info.error) {
          this.serverInfo = info
        }
      } catch (e) {
        this.proxiesError = e.message
        this.serverOnline = false
      }
    },
    formatBytes,
  },
}
</script>

<style scoped>
.frpc-panel {
  max-width: 900px;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.panel-header h2 {
  font-size: 18px;
  font-weight: 600;
}
.proxy-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.proxy-table th {
  text-align: left;
  padding: 8px 12px;
  color: var(--text-secondary);
  font-weight: 500;
  border-bottom: 1px solid var(--border);
}
.proxy-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.proxy-table tr:last-child td {
  border-bottom: none;
}
.status-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
}
.status-badge.online {
  background: rgba(102, 187, 106, 0.15);
  color: var(--green);
}
.status-badge.offline {
  background: rgba(239, 83, 80, 0.15);
  color: var(--red);
}
.error-msg {
  padding: 16px;
  color: var(--red);
  font-size: 13px;
}
</style>
