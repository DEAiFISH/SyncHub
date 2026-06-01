<template>
  <div class="sidebar">
    <div class="sidebar-logo">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="14" stroke="#4FC3F7" stroke-width="2"/>
        <path d="M10 16l4 4 8-8" stroke="#4FC3F7" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="logo-text">SyncHub</span>
    </div>
    <nav class="sidebar-nav">
      <a
        v-for="item in navItems"
        :key="item.path"
        :class="['nav-item', { active: active === item.path }]"
        @click="$emit('navigate', item.path)"
      >
        <span class="nav-icon" v-html="item.icon"></span>
        <span class="nav-label">{{ item.label }}</span>
      </a>
    </nav>
  </div>
</template>

<script>
export default {
  props: { active: String },
  emits: ['navigate'],
  data() {
    return {
      navItems: [
        {
          path: '/',
          label: '总览',
          icon: '<svg width="20" height="20" viewBox="0 0 20 20"><rect x="2" y="2" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="11" y="2" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="2" y="11" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="11" y="11" width="7" height="7" rx="1.5" fill="currentColor"/></svg>',
        },
        {
          path: '/frpc',
          label: 'FRP 隧道',
          icon: '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M3 10h14M13 6l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        },
        {
          path: '/traffic',
          label: '流量统计',
          icon: '<svg width="20" height="20" viewBox="0 0 20 20"><rect x="2" y="12" width="3" height="6" rx="0.5" fill="currentColor"/><rect x="7" y="8" width="3" height="10" rx="0.5" fill="currentColor"/><rect x="12" y="4" width="3" height="14" rx="0.5" fill="currentColor"/></svg>',
        },
        {
          path: '/syncthing',
          label: '文件同步',
          icon: '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M3 10a7 7 0 0114 0 7 7 0 01-14 0z" stroke="currentColor" stroke-width="2" fill="none"/><path d="M10 6v4l3 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        },
        {
          path: '/settings',
          label: '设置',
          icon: '<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="2" fill="none"/><path d="M10 2v2m0 12v2M2 10h2m12 0h2M4.2 4.2l1.4 1.4m8.8 8.8l1.4 1.4M4.2 15.8l1.4-1.4m8.8-8.8l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
        },
      ],
    }
  },
}
</script>
