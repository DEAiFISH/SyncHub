<template>
  <div class="dashboard" v-if="!firstLoading">
    <div class="card">
      <div class="card-header">
        <span class="card-title">FRP 隧道</span>
        <span :class="['card-status', frpcStatus]">{{ frpcStatusText }}</span>
      </div>
      <div class="card-info">
        <div class="info-row">
          <span class="info-label">服务器</span>
          <span class="info-value">{{ config.serverAddr }}:{{ config.serverPort }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">隧道数</span>
          <span class="info-value">{{ config.proxies.length }}</span>
        </div>
        <div class="info-row" v-for="p in config.proxies" :key="p.name">
          <span class="info-label">{{ p.name }}</span>
          <span class="info-value">{{ p.localPort }} → {{ p.remotePort }}</span>
        </div>
        <div class="info-row" v-if="frpcError && frpcStatus === 'error'">
          <span class="info-label">错误原因</span>
          <span class="info-value error-text">{{ frpcError }}</span>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn" @click="$router.push('/frpc')">管理面板</button>
        <button class="btn" :class="{ loading: restartingFrpc }" @click="restartFrpc"><span class="spinner"></span>重启</button>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">文件同步</span>
        <span :class="['card-status', syncthingStatus]">{{ syncthingStatusText }}</span>
      </div>
      <div class="card-info">
        <div class="info-row">
          <span class="info-label">同步文件夹</span>
          <span class="info-value">{{ syncthingInfo.folderPath || '-' }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">全局文件</span>
          <span class="info-value">{{ syncthingInfo.globalFiles ?? '-' }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">同步进度</span>
          <span class="info-value">{{ syncthingInfo.completion ?? '-' }}%</span>
        </div>
        <div class="info-row">
          <span class="info-label">远程设备</span>
          <span class="info-value">{{ syncthingInfo.remoteDevice || '-' }}</span>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn" @click="$router.push('/syncthing')">管理面板</button>
        <button class="btn" :class="{ loading: restartingSyncthing }" @click="restartSyncthing"><span class="spinner"></span>重启</button>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">流量统计</span>
        <span class="card-status" style="background: rgba(79,195,247,0.15); color: var(--accent);">实时</span>
      </div>
      <div class="card-info">
        <div class="info-row">
          <span class="info-label">今日流量</span>
          <span class="info-value">{{ formatBytes(trafficStats.todayIn + trafficStats.todayOut) }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">累计总量</span>
          <span class="info-value">{{ formatBytes(trafficStats.totalIn + trafficStats.totalOut) }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">今日入站</span>
          <span class="info-value">{{ formatBytes(trafficStats.todayIn) }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">今日出站</span>
          <span class="info-value">{{ formatBytes(trafficStats.todayOut) }}</span>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn" @click="$router.push('/traffic')">查看详情</button>
      </div>
    </div>
  </div>
  <div class="dashboard dashboard-loading" v-else>
    <div class="loading-card">
      <div class="loading-spinner"></div>
      <span>加载中...</span>
    </div>
    <div class="loading-card">
      <div class="loading-spinner"></div>
      <span>加载中...</span>
    </div>
    <div class="loading-card">
      <div class="loading-spinner"></div>
      <span>加载中...</span>
    </div>
  </div>
</template>

<script>
import { formatBytes } from '../utils/format'

export default {
  inject: ['sharedState'],
  data() {
    return {
      firstLoading: true,
      config: { serverAddr: '-', serverPort: '-', proxies: [] },
      syncthingInfo: {},
      trafficStats: { todayIn: 0, todayOut: 0, totalIn: 0, totalOut: 0 },
      restartingFrpc: false,
      restartingSyncthing: false,
      pollTimer: null,
    }
  },
  computed: {
    frpcStatus() { return this.sharedState.frpcStatus },
    frpcError() { return this.sharedState.frpcError },
    syncthingStatus() { return this.sharedState.syncthingStatus },
    syncthingError() { return this.sharedState.syncthingError },
    frpcStatusText() {
      return { running: '已连接', stopped: '已断开', unknown: '检测中...', error: '异常' }[this.frpcStatus] || this.frpcStatus
    },
    syncthingStatusText() {
      return { running: '同步中', stopped: '已停止', unknown: '检测中...', error: '异常' }[this.syncthingStatus] || this.syncthingStatus
    },
  },
  mounted() {
    this.fetchData()
    this.pollTimer = setInterval(() => this.fetchData(), 5000)
  },
  beforeUnmount() {
    if (this.pollTimer) clearInterval(this.pollTimer)
  },
  methods: {
    async fetchData() {
      if (!window.electronAPI) {
        this.firstLoading = false
        return
      }
      try {
        this.config = await window.electronAPI.getFrpcConfig()
        this.syncthingInfo = await window.electronAPI.getSyncthingInfo()
        this.trafficStats = await window.electronAPI.getTrafficStats()
      } catch (e) { console.warn('[Dashboard] 数据获取失败:', e.message) }
      finally { this.firstLoading = false }
    },
    async restartFrpc() {
      if (this.restartingFrpc) return
      this.restartingFrpc = true
      try {
        if (window.electronAPI) await window.electronAPI.restartFrpc()
        setTimeout(() => this.fetchData(), 2000)
      } finally {
        setTimeout(() => { this.restartingFrpc = false }, 3000)
      }
    },
    async restartSyncthing() {
      if (this.restartingSyncthing) return
      this.restartingSyncthing = true
      try {
        if (window.electronAPI) await window.electronAPI.restartSyncthing()
        setTimeout(() => this.fetchData(), 2000)
      } finally {
        setTimeout(() => { this.restartingSyncthing = false }, 3000)
      }
    },
    formatBytes,
  },
}
</script>
