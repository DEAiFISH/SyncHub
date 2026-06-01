import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import Dashboard from './views/Dashboard.vue'
import FrpcPanel from './views/FrpcPanel.vue'
import SyncthingPanel from './views/SyncthingPanel.vue'
import Settings from './views/Settings.vue'
import TrafficStats from './views/TrafficStats.vue'
import './assets/styles.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Dashboard },
    { path: '/frpc', component: FrpcPanel },
    { path: '/traffic', component: TrafficStats },
    { path: '/syncthing', component: SyncthingPanel },
    { path: '/settings', component: Settings },
  ],
})

const app = createApp(App)
app.use(router)
app.mount('#app')
