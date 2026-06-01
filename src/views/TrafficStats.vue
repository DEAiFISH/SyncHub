<template>
  <div class="traffic-stats">
    <div class="panel-header">
      <h2>流量统计</h2>
      <select class="period-select" v-model="period" @change="fetchHistory">
        <option :value="7">最近 7 天</option>
        <option :value="30">最近 30 天</option>
        <option :value="90">最近 90 天</option>
      </select>
    </div>

    <!-- 总流量概览 -->
    <div class="stats-overview">
      <div class="stat-card">
        <div class="stat-label">累计总流量</div>
        <div class="stat-value">{{ formatBytes(stats.totalIn + stats.totalOut) }}</div>
        <div class="stat-detail">↓ {{ formatBytes(stats.totalIn) }} / ↑ {{ formatBytes(stats.totalOut) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">今日流量</div>
        <div class="stat-value">{{ formatBytes(stats.todayIn + stats.todayOut) }}</div>
        <div class="stat-detail">↓ {{ formatBytes(stats.todayIn) }} / ↑ {{ formatBytes(stats.todayOut) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">昨日流量</div>
        <div class="stat-value">{{ formatBytes(yesterdayTraffic.in + yesterdayTraffic.out) }}</div>
        <div class="stat-detail">↓ {{ formatBytes(yesterdayTraffic.in) }} / ↑ {{ formatBytes(yesterdayTraffic.out) }}</div>
      </div>
    </div>

    <!-- 每日流量图表 -->
    <div class="card chart-card">
      <div class="card-header">
        <span class="card-title">每日流量趋势</span>
      </div>
      <div class="chart-container" v-if="history.length > 0">
        <Bar v-if="chartData" :data="chartData" :options="chartOptions" />
      </div>
      <div v-else class="empty-hint">
        暂无流量数据。流量统计记录通过 FRP 隧道（RDP、SSH）和 Syncthing 文件同步传输的数据。
      </div>
    </div>

    <!-- 每日明细表格 -->
    <div class="card" style="margin-top: 16px;">
      <div class="card-header">
        <span class="card-title">每日明细</span>
      </div>
      <table class="proxy-table" v-if="history.length > 0">
        <thead>
          <tr>
            <th>日期</th>
            <th>入站流量</th>
            <th>出站流量</th>
            <th>合计</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in history" :key="record.date">
            <td><strong>{{ record.date }}</strong></td>
            <td>{{ formatBytes(record.in) }}</td>
            <td>{{ formatBytes(record.out) }}</td>
            <td>{{ formatBytes(record.in + record.out) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty-hint">暂无历史数据</div>
    </div>
  </div>
</template>

<script>
import { formatBytes } from '../utils/format'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

export default {
  components: { Bar },
  data() {
    return {
      stats: { todayIn: 0, todayOut: 0, totalIn: 0, totalOut: 0 },
      history: [],
      period: 7,
      pollTimer: null,
    }
  },
  computed: {
    yesterdayTraffic() {
      if (this.history.length >= 2) {
        return this.history[1]
      }
      return { in: 0, out: 0 }
    },
    chartData() {
      if (this.history.length === 0) return null

      const sorted = [...this.history].sort((a, b) => a.date.localeCompare(b.date))
      const labels = sorted.map(r => {
        const parts = r.date.split('-')
        return `${parts[1]}-${parts[2]}`
      })

      return {
        labels,
        datasets: [
          {
            label: '入站',
            data: sorted.map(r => +(r.in / (1024 * 1024)).toFixed(2)),
            backgroundColor: 'rgba(79, 195, 247, 0.6)',
            borderColor: '#4FC3F7',
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            label: '出站',
            data: sorted.map(r => +(r.out / (1024 * 1024)).toFixed(2)),
            backgroundColor: 'rgba(102, 187, 106, 0.6)',
            borderColor: '#66BB6A',
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      }
    },
    chartOptions() {
      return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: '#9a9ab0',
              font: { size: 12 },
            },
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                return `${context.dataset.label}: ${context.parsed.y.toFixed(2)} MB`
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#9a9ab0', font: { size: 11 } },
            grid: { color: 'rgba(58, 59, 80, 0.5)' },
          },
          y: {
            ticks: {
              color: '#9a9ab0',
              font: { size: 11 },
              callback: (value) => value + ' MB',
            },
            grid: { color: 'rgba(58, 59, 80, 0.5)' },
            beginAtZero: true,
          },
        },
      }
    },
  },
  async mounted() {
    await this.fetchData()
    await this.fetchHistory()
    this.pollTimer = setInterval(() => this.fetchData(), 30000)
  },
  beforeUnmount() {
    if (this.pollTimer) clearInterval(this.pollTimer)
  },
  methods: {
    async fetchData() {
      if (!window.electronAPI) return
      try {
        this.stats = await window.electronAPI.getTrafficStats()
      } catch { /* ignore */ }
    },
    async fetchHistory() {
      if (!window.electronAPI) return
      try {
        this.history = await window.electronAPI.getTrafficHistory(this.period)
      } catch { /* ignore */ }
    },
    formatBytes,
  },
}
</script>

<style scoped>
.traffic-stats {
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
.period-select {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  color: var(--text-primary);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  cursor: pointer;
}
.period-select:focus {
  border-color: var(--accent);
}
.stats-overview {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
  margin-bottom: 16px;
}
.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 20px;
}
.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--accent);
  margin-bottom: 4px;
}
.stat-detail {
  font-size: 12px;
  color: var(--text-secondary);
}
.chart-card {
  padding: 20px;
}
.chart-container {
  height: 280px;
  position: relative;
}
.empty-hint {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}
</style>
