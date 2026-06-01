<template>
  <div class="settings-page">
    <div class="settings-section">
      <h3>FRP 服务器</h3>
      <div class="setting-item">
        <span class="setting-label">服务器地址</span>
        <input class="setting-input" v-model="frpcConfig.serverAddr" @input="markFrpcDirty" />
      </div>
      <div class="setting-item">
        <span class="setting-label">服务器端口</span>
        <input class="setting-input" type="number" v-model.number="frpcConfig.serverPort" min="1" max="65535" @input="markFrpcDirty" />
      </div>
      <div class="setting-item">
        <span class="setting-label">认证 Token</span>
        <input class="setting-input" type="password" v-model="frpcConfig.authToken" @input="markFrpcDirty" />
      </div>
      <div class="setting-item" v-if="frpcDirty" style="justify-content: flex-end; border-bottom: none; padding-top: 4px;">
        <button class="btn btn-sm" @click="cancelFrpcEdit" style="margin-right: 8px; background: var(--border);">取消</button>
        <button class="btn btn-sm" :class="{ loading: savingFrpc }" @click="saveFrpc" style="background: var(--accent); color: var(--bg-primary);">
          <span class="spinner"></span>保存并重启
        </button>
      </div>
      <div class="setting-item" v-if="frpcValidationError" style="border-bottom: none; padding-top: 0;">
        <span style="color: var(--red); font-size: 12px;">{{ frpcValidationError }}</span>
      </div>
    </div>

    <div class="settings-section">
      <h3>Syncthing</h3>
      <div class="setting-item">
        <span class="setting-label">同步目录</span>
        <div class="sync-dir-row">
          <input class="setting-input" style="width:260px" v-model="syncDir" :disabled="savingDir" />
          <button class="btn btn-sm" :class="{ loading: savingDir }" @click="saveSyncDir">
            <span class="spinner"></span>保存并重启
          </button>
        </div>
      </div>
      <div class="setting-item">
        <span class="setting-label">本机设备 ID</span>
        <span class="setting-value">{{ syncthingInfo.deviceId || '-' }}</span>
      </div>
    </div>

    <div class="settings-section">
      <div class="log-header">
        <h3>运行日志</h3>
        <div class="log-actions">
          <span v-if="copied" class="copy-hint">已复制</span>
          <span v-if="exported" class="copy-hint">已导出</span>
          <button class="btn btn-sm" :class="{ loading: copyingLogs }" @click="copyLogs"><span class="spinner"></span>复制日志</button>
          <button class="btn btn-sm" :class="{ loading: exportingLogs }" @click="exportLogs"><span class="spinner"></span>导出日志</button>
          <button class="btn btn-sm" @click="clearLogs">清屏</button>
        </div>
      </div>
      <div
        class="log-area"
        ref="logArea"
        @click="enableSelect"
        :class="{ selectable: logSelectable }"
      >{{ displayLogs }}</div>
    </div>

    <div class="settings-section">
      <h3>应用</h3>
      <div class="setting-item">
        <span class="setting-label">开机自启动</span>
        <label class="toggle">
          <input type="checkbox" v-model="autoStart" @change="toggleAutoStart" />
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      frpcConfig: { serverAddr: '', serverPort: 7000, authToken: '' },
      frpcConfigOrig: {},
      frpcDirty: false,
      frpcValidationError: '',
      savingFrpc: false,
      syncthingInfo: {},
      syncDir: '',
      savingDir: false,
      logs: '',
      displayLogs: '',
      autoStart: true,
      logTimer: null,
      logSelectable: false,
      copied: false,
      copyingLogs: false,
      exported: false,
      exportingLogs: false,
    }
  },
  async mounted() {
    if (window.electronAPI) {
      this.frpcConfig = await window.electronAPI.getFrpcConfig()
      this.frpcConfigOrig = JSON.parse(JSON.stringify(this.frpcConfig))
      this.syncthingInfo = await window.electronAPI.getSyncthingInfo()
      this.syncDir = this.syncthingInfo.folderPath || ''
      this.logs = await window.electronAPI.getLogs()
      this.displayLogs = this.logs
    }
    this.logTimer = setInterval(async () => {
      if (window.electronAPI) {
        this.logs = await window.electronAPI.getLogs()
        const el = this.$refs.logArea
        const atBottom = el && (el.scrollTop + el.clientHeight >= el.scrollHeight - 20)
        this.displayLogs = this.logs
        if (atBottom) {
          this.$nextTick(() => { el.scrollTop = el.scrollHeight })
        }
      }
    }, 2000)
  },
  beforeUnmount() {
    if (this.logTimer) clearInterval(this.logTimer)
  },
  methods: {
    markFrpcDirty() {
      this.frpcDirty = JSON.stringify(this.frpcConfig) !== JSON.stringify(this.frpcConfigOrig)
      this.frpcValidationError = ''
    },
    cancelFrpcEdit() {
      this.frpcConfig = JSON.parse(JSON.stringify(this.frpcConfigOrig))
      this.frpcDirty = false
      this.frpcValidationError = ''
    },
    validateFrpc() {
      if (!this.frpcConfig.serverAddr || !this.frpcConfig.serverAddr.trim()) {
        this.frpcValidationError = '服务器地址不能为空'
        return false
      }
      const port = Number(this.frpcConfig.serverPort)
      if (!port || port < 1 || port > 65535 || !Number.isInteger(port)) {
        this.frpcValidationError = '端口必须为 1-65535 的整数'
        return false
      }
      if (!this.frpcConfig.authToken || !this.frpcConfig.authToken.trim()) {
        this.frpcValidationError = '认证 Token 不能为空'
        return false
      }
      this.frpcValidationError = ''
      return true
    },
    async saveFrpc() {
      if (this.savingFrpc) return
      if (!this.validateFrpc()) return
      this.savingFrpc = true
      try {
        if (window.electronAPI) await window.electronAPI.saveFrpcConfig(this.frpcConfig)
        this.frpcConfigOrig = JSON.parse(JSON.stringify(this.frpcConfig))
        this.frpcDirty = false
      } finally {
        setTimeout(() => { this.savingFrpc = false }, 1000)
      }
    },
    async toggleAutoStart() {
      if (window.electronAPI) await window.electronAPI.setAutoStart(this.autoStart)
    },
    enableSelect() {
      this.logSelectable = true
    },
    async copyLogs() {
      if (this.copyingLogs) return
      this.copyingLogs = true
      try {
        await navigator.clipboard.writeText(this.logs)
        this.copied = true
        setTimeout(() => { this.copied = false }, 2000)
      } catch {
        const el = this.$refs.logArea
        if (el) {
          const range = document.createRange()
          range.selectNodeContents(el)
          const sel = window.getSelection()
          sel.removeAllRanges()
          sel.addRange(range)
        }
      } finally {
        setTimeout(() => { this.copyingLogs = false }, 800)
      }
    },
    clearLogs() {
      this.displayLogs = ''
      this.logs = ''
    },
    async exportLogs() {
      if (this.exportingLogs) return
      this.exportingLogs = true
      try {
        if (window.electronAPI) {
          const savedPath = await window.electronAPI.exportLogs()
          if (savedPath) {
            this.exported = true
            setTimeout(() => { this.exported = false }, 2000)
          }
        }
      } finally {
        setTimeout(() => { this.exportingLogs = false }, 800)
      }
    },
    async saveSyncDir() {
      if (this.savingDir || !this.syncDir.trim()) return
      this.savingDir = true
      try {
        await window.electronAPI.updateSyncDir(this.syncDir.trim())
      } finally {
        setTimeout(() => { this.savingDir = false }, 1000)
      }
    },
  },
}
</script>
