<template>
  <div class="status-bar">
    <div class="status-item" :title="frpcError || ''">
      <span :class="['status-dot', frpcStatus]"></span>
      <span>FRP: {{ statusText(frpcStatus) }}</span>
      <span v-if="frpcError && frpcStatus === 'error'" class="status-error-detail">{{ truncateError(frpcError) }}</span>
    </div>
    <div class="status-item" :title="syncthingError || ''">
      <span :class="['status-dot', syncthingStatus]"></span>
      <span>Syncthing: {{ statusText(syncthingStatus) }}</span>
      <span v-if="syncthingError && syncthingStatus === 'error'" class="status-error-detail">{{ truncateError(syncthingError) }}</span>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    frpcStatus: String,
    frpcError: String,
    syncthingStatus: String,
    syncthingError: String,
  },
  methods: {
    statusText(status) {
      const map = {
        running: '运行中',
        stopped: '已停止',
        unknown: '检测中...',
        error: '异常',
      }
      return map[status] || status
    },
    truncateError(err) {
      if (!err) return ''
      const max = 60
      return err.length > max ? err.substring(0, max) + '...' : err
    },
  },
}
</script>
