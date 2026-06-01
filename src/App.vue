<template>
  <div class="app-layout">
    <Sidebar :active="currentRoute" @navigate="navigate" />
    <div class="main-area">
      <div class="topbar">
        <span class="app-title">SyncHub</span>
        <div class="topbar-actions">
          <button class="btn-icon" @click="minimizeWindow" title="最小化">
            <svg width="16" height="16" viewBox="0 0 16 16"><rect y="7" width="16" height="2" fill="currentColor"/></svg>
          </button>
          <button class="btn-icon btn-close" @click="closeWindow" title="隐藏到托盘">
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2"/></svg>
          </button>
        </div>
      </div>
      <div class="content">
        <router-view />
      </div>
      <StatusBar :frpc-status="frpcStatus" :frpc-error="frpcError" :syncthing-status="syncthingStatus" :syncthing-error="syncthingError" />
    </div>
  </div>
</template>

<script>
import { reactive } from 'vue'
import Sidebar from './components/Sidebar.vue'
import StatusBar from './components/StatusBar.vue'

const sharedState = reactive({
  frpcStatus: 'unknown',
  frpcError: null,
  syncthingStatus: 'unknown',
  syncthingError: null,
})

export default {
  components: { Sidebar, StatusBar },
  provide() {
    return { sharedState }
  },
  data() {
    return {
      pollTimer: null,
    }
  },
  computed: {
    currentRoute() {
      return this.$route.path
    },
    frpcStatus() { return sharedState.frpcStatus },
    frpcError() { return sharedState.frpcError },
    syncthingStatus() { return sharedState.syncthingStatus },
    syncthingError() { return sharedState.syncthingError },
  },
  mounted() {
    this.pollStatus()
    this.pollTimer = setInterval(() => this.pollStatus(), 3000)
  },
  beforeUnmount() {
    if (this.pollTimer) clearInterval(this.pollTimer)
  },
  methods: {
    navigate(path) {
      this.$router.push(path)
    },
    async pollStatus() {
      if (window.electronAPI) {
        try {
          const frpcResult = await window.electronAPI.getFrpcStatus()
          sharedState.frpcStatus = typeof frpcResult === 'object' ? frpcResult.processStatus : frpcResult
          sharedState.frpcError = typeof frpcResult === 'object' ? frpcResult.lastError : null
          const syncthingResult = await window.electronAPI.getSyncthingStatus()
          sharedState.syncthingStatus = typeof syncthingResult === 'object' ? syncthingResult.processStatus : syncthingResult
          sharedState.syncthingError = typeof syncthingResult === 'object' ? syncthingResult.lastError : null
        } catch (e) {
          console.warn('[SyncHub] 状态轮询失败:', e.message)
        }
      }
    },
    minimizeWindow() {
      if (window.electronAPI) window.electronAPI.minimizeWindow()
    },
    closeWindow() {
      if (window.electronAPI) window.electronAPI.closeWindow()
    },
  },
}
</script>
