# SyncHub

基于 Electron + Vue 3 的桌面应用，集成 **frpc**（内网穿透）和 **Syncthing**（文件同步），实现远程设备间的文件自动同步。

## 功能概览

- **内网穿透** — 内嵌 frpc，自动建立 RDP/SSH 等隧道，远程访问内网设备
- **文件同步** — 内嵌 Syncthing，自动发现并连接服务器，P2P 双向同步文件
- **流量统计** — 同时采集 FRP 隧道流量和 Syncthing 同步流量，支持按日/周/月查看
- **一键管理** — 图形化界面管理服务启停、配置修改、日志查看
- **自动恢复** — frpc.exe 被 Windows Defender 删除后自动下载恢复（含 SHA256 校验）
- **系统托盘** — 关闭窗口隐藏到托盘，右键菜单快速重启服务

## 技术栈

| 组件 | 版本 |
|------|------|
| Electron | 35.0 |
| Vue | 3.5 |
| Vite | 6.3 |
| frp | v0.69.0 |
| Syncthing | v2.1.0 |
| Chart.js | 4.5 |

## 项目结构

```
SyncHub/
├── electron/                  # Electron 主进程
│   ├── main.js                # 主进程入口（IPC、窗口、托盘）
│   ├── preload.js             # 预加载脚本（前后端桥接）
│   └── services/
│       ├── config.js          # 配置管理、凭证获取、二进制恢复
│       ├── frpc.js            # frpc 进程管理（启动/停止/自动重试）
│       ├── frps-api.js        # frps Dashboard API 调用
│       ├── syncthing.js       # Syncthing 进程管理、配置补丁、设备注册
│       └── traffic.js         # 流量采集（frps + Syncthing 双数据源）
├── src/                       # Vue 前端
│   ├── App.vue                # 根组件（布局、轮询状态）
│   ├── main.js                # 路由定义
│   ├── components/
│   │   ├── Sidebar.vue        # 侧边栏导航
│   │   └── StatusBar.vue      # 底部状态栏
│   ├── views/
│   │   ├── Dashboard.vue      # 总览页
│   │   ├── FrpcPanel.vue      # FRP 隧道管理
│   │   ├── TrafficStats.vue   # 流量统计图表
│   │   ├── SyncthingPanel.vue # 文件同步管理
│   │   └── Settings.vue       # 设置页
│   └── utils/
│       └── format.js          # 工具函数
├── build/
│   └── installer.nsh          # NSIS 安装脚本（Defender 排除项）
├── resources/
│   ├── bin/                   # frpc、syncthing 二进制文件
│   └── icon.ico / icon.png    # 应用图标
├── index.html                 # Vite 入口
├── package.json
├── vite.config.js
└── electron-builder.yml       # 打包配置
```

## 快速开始

### 环境要求

- Node.js 18+
- Windows 10/11 或 macOS

### 安装依赖

```powershell
# Windows 下建议设置 Electron 镜像
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

npm install
```

### 开发模式

```powershell
# 终端 1：启动 Vite 前端
npm run dev

# 终端 2：启动 Electron
npx electron .
```

或一键启动：

```powershell
npm run electron:dev
```

### 构建打包

```powershell
npm run electron:build
```

输出安装包在 `release/` 目录。

## 页面说明

### 总览（Dashboard）

显示 FRP 和 Syncthing 的运行状态、最新错误信息、流量统计摘要。支持一键重启服务。

### FRP 隧道

展示 frps 服务器状态（在线/离线、版本、今日流量）和隧道列表（名称、状态、本地/远程端口、连接数）。

### 流量统计

- 今日/昨日/累计流量概览
- 每日流量柱状图（支持 7/30/90 天）
- 每日明细表格

数据来源：FRP 隧道中转流量 + Syncthing P2P 同步流量，每 30 秒采集一次。

### 文件同步

显示同步目录路径、同步完成度、全局文件数、远程设备信息。可跳转 Syncthing Web UI 进行高级管理。

### 设置

| 设置项 | 说明 |
|--------|------|
| FRP 服务器 | 修改服务器地址、端口、认证 Token |
| 同步目录 | 修改 Syncthing 同步目录（自动重启生效） |
| 运行日志 | 查看 FRP + Syncthing 实时日志，支持导出 |
| 开机自启 | 设置系统开机自动启动 |

## 数据目录

应用数据存储在用户主目录下：

| 路径 | 用途 |
|------|------|
| `~/SyncHub/bin/` | frpc.exe、syncthing.exe 运行时副本 |
| `~/SyncHub/config/` | 配置文件（frpc.toml、settings.json） |
| `~/SyncHub/data/` | 默认同步目录（可在设置中修改） |
| `~/SyncHub/syncthing/` | Syncthing 配置与数据库 |

## 服务器端部署

需要在公网服务器上部署 frps 和 Syncthing：

```bash
# frps 监听端口
7000  # frp 隧道
7500  # frps Dashboard API

# Syncthing 监听端口
22000 # 同步协议
8384  # Web UI
```

## 默认隧道

应用预配置两条隧道（可在设置页修改）：

| 名称 | 协议 | 本地端口 | 远程端口 | 用途 |
|------|------|---------|---------|------|
| rdp | TCP | 3389 | 6000 | 远程桌面 |
| ssh | TCP | 22 | 6001 | SSH 远程连接 |

## Windows Defender 兼容

frpc.exe 可能被 Windows Defender 误报删除，应用提供多层恢复机制：

1. 安装时自动添加安装目录和用户数据目录的 Defender 排除项
2. 运行时从安装包 resources 目录恢复二进制文件
3. 若 resources 也被删除，自动添加排除项并从网络下载（含 SHA256 校验）
4. 下载镜像：阿里云自建 > GitHub 国内镜像 > GitHub 直连

## License

MIT
