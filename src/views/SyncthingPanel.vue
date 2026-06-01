<template>
  <div class="iframe-container">
    <div v-if="loadError" class="panel-error">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--yellow)" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <p style="margin-top: 12px; font-size: 14px; color: var(--text-primary);">Syncthing 面板加载失败</p>
      <p style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">{{ loadError }}</p>
      <button class="btn" style="margin-top: 16px;" @click="retry">重新加载</button>
    </div>
    <webview
      v-show="!loadError"
      :src="syncthingUrl"
      class="panel-frame"
      ref="webview"
    ></webview>
  </div>
</template>

<script>
export default {
  data() {
    return {
      syncthingUrl: 'http://127.0.0.1:8384',
      loadError: '',
    }
  },
  mounted() {
    this.setupWebview()
  },
  methods: {
    setupWebview() {
      const webview = this.$refs.webview
      if (!webview) return

      webview.addEventListener('did-fail-load', (e) => {
        if (e.errorCode === -3) return // 用户取消，忽略
        this.loadError = e.errorDescription || `错误码: ${e.errorCode}`
      })

      webview.addEventListener('did-finish-load', () => {
        this.loadError = ''
        webview.insertCSS(`
          /* 暗色主题覆盖 Syncthing WebUI */
          body, .navbar, .panel, .panel-body, .panel-heading,
          .container-fluid, .row, div, section, main, header, footer,
          .form-control, .btn-default, .dropdown-menu,
          table, thead, tbody, tr, td, th,
          .well, .list-group-item, .modal-content {
            background-color: #232438 !important;
            color: #e8e8f0 !important;
            border-color: #3a3b50 !important;
          }
          /* 输入框和选择框 */
          input, select, textarea {
            background-color: #1a1b2e !important;
            color: #e8e8f0 !important;
            border-color: #3a3b50 !important;
          }
          /* 链接 */
          a, a:visited {
            color: #4FC3F7 !important;
          }
          a:hover {
            color: #6FD0FF !important;
          }
          /* 按钮 */
          .btn-primary {
            background-color: #4FC3F7 !important;
            border-color: #4FC3F7 !important;
            color: #1a1b2e !important;
          }
          .btn-danger {
            background-color: #EF5350 !important;
            border-color: #EF5350 !important;
          }
          .btn-warning {
            background-color: #FFA726 !important;
            border-color: #FFA726 !important;
          }
          .btn-success {
            background-color: #66BB6A !important;
            border-color: #66BB6A !important;
          }
          /* 导航栏 */
          .navbar-default {
            background-color: #1a1b2e !important;
            border-color: #3a3b50 !important;
          }
          .navbar-default .navbar-brand,
          .navbar-default .navbar-nav > li > a {
            color: #4FC3F7 !important;
          }
          /* 面板 */
          .panel {
            background-color: #2a2b40 !important;
          }
          .panel-heading {
            background-color: #232438 !important;
            border-color: #3a3b50 !important;
            color: #4FC3F7 !important;
          }
          /* 表格 */
          .table-striped > tbody > tr:nth-of-type(odd) {
            background-color: #1e1f33 !important;
          }
          .table > thead > th {
            border-color: #3a3b50 !important;
            color: #9a9ab0 !important;
          }
          /* 进度条 */
          .progress {
            background-color: #1a1b2e !important;
          }
          .progress-bar {
            background-color: #4FC3F7 !important;
          }
          /* 标签 */
          .label-success {
            background-color: #66BB6A !important;
          }
          .label-danger {
            background-color: #EF5350 !important;
          }
          .label-warning {
            background-color: #FFA726 !important;
          }
          .label-default {
            background-color: #3a3b50 !important;
            color: #9a9ab0 !important;
          }
          /* 下拉菜单 */
          .dropdown-menu {
            background-color: #2a2b40 !important;
          }
          .dropdown-menu > li > a {
            color: #e8e8f0 !important;
          }
          .dropdown-menu > li > a:hover {
            background-color: #3a3b50 !important;
          }
          /* 弹窗 */
          .modal-header, .modal-footer {
            border-color: #3a3b50 !important;
          }
          /* 搜索框 */
          .syncthing-search {
            background-color: #1a1b2e !important;
            color: #e8e8f0 !important;
          }
          /* 滚动条 */
          ::-webkit-scrollbar {
            width: 8px;
          }
          ::-webkit-scrollbar-track {
            background: #1a1b2e;
          }
          ::-webkit-scrollbar-thumb {
            background: #3a3b50;
            border-radius: 4px;
          }
          /* 隐藏顶部导航栏多余元素 */
          .navbar-collapse {
            background-color: transparent !important;
          }
          /* 图表和状态文字 */
          text {
            fill: #9a9ab0 !important;
          }
          .text-muted {
            color: #9a9ab0 !important;
          }
          .text-success {
            color: #66BB6A !important;
          }
          .text-danger {
            color: #EF5350 !important;
          }
          .text-warning {
            color: #FFA726 !important;
          }
          /* popover */
          .popover {
            background-color: #2a2b40 !important;
            border-color: #3a3b50 !important;
          }
          .popover-title {
            background-color: #232438 !important;
            border-color: #3a3b50 !important;
            color: #e8e8f0 !important;
          }
          .popover-content {
            color: #e8e8f0 !important;
          }
          /* code */
          code {
            background-color: #1a1b2e !important;
            color: #4FC3F7 !important;
          }
          /* Syncthing v2 specific */
          .device-name, .folder-name {
            color: #e8e8f0 !important;
          }
          .status-text {
            color: #9a9ab0 !important;
          }
        `)
      })
    },
    retry() {
      this.loadError = ''
      const webview = this.$refs.webview
      if (webview) {
        webview.loadURL(this.syncthingUrl)
      }
    },
  },
}
</script>

<style scoped>
.panel-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 300px;
  text-align: center;
}
</style>
