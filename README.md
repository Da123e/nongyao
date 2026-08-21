# 🔗 金生链——基于区块链物联网的花生全产业链溯源平台

一套基于 **区块链 + IPFS + IoT 传感器** 的花生全产业链溯源管理平台，覆盖从种子采购到终端销售的完整闭环，实现数据防篡改、全链路可信溯源。

> 📖 **详细文档**：请查阅 [项目说明文档.md](./项目说明文档.md)，包含完整的架构图、数据流图、ER 图、业务流程图、权限体系、API 接口等详细信息。

## 🌐 功能模块

| 模块 | 路径 | 核心功能 |
|------|------|---------|
| 🌱 种子溯源 | `/seed` | 供应商管理、批次管理、质量检测、区块链上链 |
| 🌾 种植管理 | `/planting` | 地块管理、种植记录、环境监测、农事活动 |
| 🌿 农药管理 | `/pesticide` | 农药管理、采购记录、施用记录、残留检测 |
| 📋 检测报告 | `/inspection` | 报告管理、农残检测、PDF 导出（电子签名） |
| 🏭 加工生产 | `/processing` | 加工批次、工艺记录、成品质检 |
| 📦 库存管理 | `/inventory` | 仓库管理、库存预警、出入库记录 |
| 💰 销售管理 | `/sales` | 客户管理、订单管理、物流跟踪（状态机） |
| 🔍 溯源查询 | `/trace` | 全链溯源、链验证、二维码生成 |
| 📡 传感器数据 | `/sensor` | 15 种传感器（含 RS485 土壤多参数 8 项 / Modbus RTU）、三模式录入、首页每 5 秒刷新、日期选择查询 + 当日 avg/min/max 统计 + 逐条记录、图表 |

## 🛠️ 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端 | React + TypeScript + Vite | 19.x / 5.8.x / 5.4.x |
| UI | Tailwind CSS + lucide-react | 3.4.x |
| 图表 | Chart.js + Framer Motion | 4.5.x / 12.x |
| 后端 | FastAPI + SQLAlchemy | 0.104.x / 2.0.x |
| 数据库 | MySQL | 8.0 |
| 认证 | JWT + bcrypt | - |
| 区块链 | Web3.py + Ganache | 6.x / 7.9.x |
| 分布式存储 | IPFS Kubo | - |
| PDF生成 | ReportLab | 4.0+ |

## 🏗️ 系统架构

```mermaid
flowchart TB
    classDef role fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e,stroke-width:1.5px
    classDef fePage fill:#ecfeff,stroke:#0891b2,color:#083344,stroke-width:1.5px
    classDef feCore fill:#f0fdfa,stroke:#0d9488,color:#042f2e,stroke-width:1.5px
    classDef beRouter fill:#fff7ed,stroke:#ea580c,color:#7c2d12,stroke-width:1.5px
    classDef beCore fill:#fdf2f8,stroke:#db2777,color:#831843,stroke-width:1.5px
    classDef infra fill:#f5f3ff,stroke:#7c3aed,color:#3b0764,stroke-width:1.5px
    classDef db fill:#fef9c3,stroke:#ca8a04,color:#713f12,stroke-width:1.5px
    classDef sensor fill:#dcfce7,stroke:#16a34a,color:#052e16,stroke-width:1.5px

    subgraph 用户层 [👥 用户角色层  金生链 5 类 RBAC 角色]
        direction LR
        A1[👑 admin<br>系统管理员]
        A2[🌾 farmer<br>种植户]
        A3[🔬 inspector<br>质检员]
        A4[📦 warehouse_manager<br>仓库管理员]
        A5[💰 salesperson<br>销售人员]
    end
    class A1,A2,A3,A4,A5 role

    A1 --> F1
    A2 --> F1
    A3 --> F1
    A4 --> F1
    A5 --> F1
    A4 --> F2
    A5 --> F3

    subgraph 前端展示层 [🖥️ 前端展示层  React 19 + TypeScript + Vite + Tailwind CSS]
        direction TB
        F1[🏠 Dashboard<br>首页 环境卡片 5 秒自动刷新<br>统计 + 通知中心]
        F2[📦 InventoryManage<br>库存管理]
        F3[💰 SalesManage<br>销售管理]
        F4[🌱 SeedTrace · PlantingManage<br>种子溯源 + 种植管理]
        F5[🌿 PesticideManage<br>农药管理]
        F6[📋 InspectionReport<br>检测报告 PDF 电子签名]
        F7[🏭 ProcessingManage<br>加工生产]
        F8[📡 SensorDataEntry<br>传感器三模式录入<br>Modbus RTU 8 项土壤参数]
        F9[🔍 TraceQuery<br>全链路溯源 · 二维码 · 链验证]
        F_Core{{核心组件<br>Layout · ProtectedRoute · BatchChainView<br>SensorTrendChart · StatCard · ErrorBoundary}}
        F_Auth{{权限中心<br>RBAC 5 角色 · resolveUserRole 唯一来源<br>roles.ts · auth.ts 共享函数}}
        F_WS[📡 SensorContext<br>WebSocket 实时推送]
        F_HW[🔌 Web Serial API<br>硬件连接 · CH340 RS485]
    end
    class F1,F2,F3,F4,F5,F6,F7,F8,F9 fePage
    class F_Core,F_Auth,F_WS,F_HW feCore

    F1 --> B1
    F2 --> B1
    F3 --> B1
    F4 --> B1
    F5 --> B1
    F6 --> B1
    F7 --> B1
    F8 --> B1
    F9 --> B1
    F_WS --> B_WS
    F8 --> F_HW

    subgraph 后端服务层 [⚙️ 后端服务层  FastAPI + SQLAlchemy 2.0 + Pydantic]
        direction TB
        B1[🔐 认证路由 · /api/auth<br>login · seed-data · users/me]
        B2[🌱 种子区块链 · /api/blockchain/seed<br>批次生成 · SHA256哈希 · ECDSA签名 · 上链]
        B3[🌾 种植 · /api/planting<br>地块 + 种植记录 + 农事 + 环境数据]
        B4[🌿 农药 · /api/pesticide<br>农药库 + 采购 + 施用「上链」]
        B5[📋 检测 · /api/inspection<br>报告 CRUD + ReportLab PDF 导出]
        B6[🏭 加工 · /api/processing<br>批次「上链」+ 工艺 + 成品质检]
        B7[📦 库存 · /api/inventory<br>仓库 + 出入库 + 阈值预警通知]
        B8[💰 销售 · /api/sales<br>客户 + 订单「上链」+ 物流状态机]
        B9[📡 传感器 · /api/measurements<br>数据入库 · latest-environmental · 当日 avg/min/max]
        B10[🔍 溯源聚合 · /api/sales/trace_by_batch<br>9 模块聚合 + 链上哈希校验]
        B11[🔔 通知中心 · /api/notifications<br>用户通知 CRUD · 未读计数 · 全部已读]
        B_WS[⚡ WebSocket /api/ws<br>传感器实时数据广播]
        B_Helper{{notifications_helper.py<br>订单 报告 种子 库存 农药 · 5 场景自动推送}}
        B_Auth{{auth.py 中间件<br>bcrypt 哈希 · JWT 签发 · require_permission<br>RBAC 权限点校验}}
        B_Migrate{{自动列迁移<br>environmental_data 6 土壤参数列自动补齐}}
    end
    class B1,B2,B3,B4,B5,B6,B7,B8,B9,B10,B11,B_WS beRouter
    class B_Helper,B_Auth,B_Migrate beCore

    B2 --> C1
    B3 --> C1
    B3 --> C2
    B4 --> C1
    B6 --> C1
    B8 --> C1
    B9 --> C2
    B11 --> C3
    B_Helper --> C3
    B2 --> C4
    B10 --> C1

    subgraph 基础设施与数据层 [☁️ 基础设施与数据层  40 张 MySQL 表 + 以太坊侧链 + IPFS + 硬件]
        direction LR
        C1[(⛓️ Ganache 以太坊测试链<br>PeanutTrace.sol 智能合约<br>10 个上链点存证)]
        C2[(🗄️ MySQL 8.0 · peanut_chain<br>40 张表 · 环境数据 测量值 链记录<br>库存 · 订单 · 通知 · 传感器)]
        C3[👤 用户与通知<br>users · roles · notifications]
        C4[📦 IPFS Kubo 分布式存储<br>溯源报告 · 检测附件 · QR 图片]
        C5[🌡️ RS485 土壤多参数传感器<br>8 项：含水率 土壤温度 电导率 pH 氮 磷 钾 盐分]
    end
    class C1,C2,C3,C4 infra
    class C3 db
    class C5 sensor

    F_HW --> C5
    C5 --> F8
```

### ⛓️ 花生全产业链溯源时序（10 个区块链上链点）

```mermaid
sequenceDiagram
    actor F as 🌾 种植户/管理员
    participant FE as 💻 金生链 前端
    participant BE as ⚙️ FastAPI 后端
    participant BC as ⛓️ 智能合约 PeanutTrace
    participant IPFS as 📦 IPFS
    participant DB as 🗄️ MySQL

    Note over F,DB: 阶段 1：种子批次登记「上链点 ①」
    F->>FE: 提交种子供应商 & 批次信息
    FE->>BE: POST /api/blockchain/seed/register
    BE->>BE: SHA256 哈希 + ECDSA 签名
    BE->>IPFS: add_json_data 批次附件
    IPFS-->>BE: 返回 CID
    BE->>BC: addRecord batchCode stage hash signature cid
    BC-->>BE: tx_hash + block_number
    BE->>DB: INSERT blockchain_record + seed_batch
    BE-->>FE: 🔔 种子上链成功通知 admin

    Note over F,DB: 阶段 2：种植记录「上链点 ②」→ 田间管理
    F->>FE: 登记种植地块 · 播种量
    FE->>BE: POST /api/planting/records
    BE->>BC: addRecord 种植
    BE->>DB: 写入 planting_record

    loop 3 秒周期采集 传感器三模式
        F->>FE: 选地块 → 硬件/模拟/手动录入
        FE->>BE: POST /api/measurements/data plot_code=P001
        BE->>DB: INSERT measurement + environmental_data
        BE->>BE: WS 广播 → 首页环境卡片 5 秒刷新
    end

    Note over F,DB: 阶段 3：农药施用「上链点 ③」+ 农残检测
    F->>FE: 登记农药名称 / 用量 / 安全间隔期
    FE->>BE: POST /api/pesticide/applications
    BE->>BC: addRecord 农药
    BE->>DB: 写入 pesticide_application
    BE-->>FE: 🔔 管理员通知

    Note over F,DB: 阶段 4：田间检测报告「上链点 ④」
    F->>FE: 编写检测报告 合格/不合格
    FE->>BE: POST /api/inspection/reports
    BE->>BC: addRecord 田间检测
    BE->>DB: 写入 inspection_report
    BE-->>FE: 🔔 质检员+管理员通知 不合格时为 warning

    Note over F,DB: 阶段 5：采收「上链点 ⑤」→ 加工「上链点 ⑥」→ 成品质检「上链点 ⑦」
    F->>BE: 采收登记 → 加工批次 → 成品质检
    BE->>BC: 三次 addRecord 上链
    BE->>DB: 三次 DB 写入

    Note over F,DB: 阶段 6：成品入库「上链点 ⑧」
    F->>FE: 入库 → 库存项增加
    FE->>BE: POST /api/inventory/transactions 出入库交易
    alt 库存 < 阈值 min_stock
        BE-->>FE: 🔔 仓管员+管理员 库存预警通知
    end

    Note over F,DB: 阶段 7：物流发货「上链点 ⑨」
    actor S as 💰 销售人员
    S->>FE: 创建订单 → 发货
    FE->>BE: POST /sales/orders
    BE->>BC: addRecord 物流
    BE->>DB: 更新物流状态机
    BE-->>FE: 🔔 销售员+管理员 新订单通知

    Note over F,DB: 阶段 8：销售出库「上链点 ⑩」· 消费者扫码溯源
    actor C as 🛒 消费者 / 评委
    C->>FE: 扫码 → /trace 溯源查询
    FE->>BE: GET /api/sales/trace_by_batch
    BE->>DB: 聚合 9 模块数据 + 链记录
    BE->>BC: verify_chain_integrity 哈希校验
    BC-->>BE: 链上哈希 vs 数据库哈希 → 一致✅
    BE-->>FE: 返回全链路溯源数据 + 链验证结果
    FE-->>C: 时间线展示 种子→种植→农药→检测→加工→库存→销售
```

## 📋 环境要求

- Node.js >= 20.x
- Python >= 3.11
- MySQL >= 8.0
- Ganache（可选，用于以太坊侧链存证）
- IPFS Kubo（可选，用于溯源报告分布式存储）

## 🚀 快速启动

### 本地开发启动

```bash
# 1. 克隆项目
git clone https://github.com/Da123e/nongyao.git
cd nongyao

# 2. 创建 MySQL 数据库
mysql -u root -p -e "CREATE DATABASE peanut_chain CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 3. 安装后端依赖并配置环境变量
cd backend
pip install -r requirements.txt
# ⚠️  创建 backend/.env 并填写你本机的实际配置（不要把真实密码提交到 Git）：
# DATABASE_URL=mysql+pymysql://root:你的MySQL密码@localhost:3306/peanut_chain?charset=utf8mb4
# SECRET_KEY=请设置足够长且随机的安全密钥
# DEBUG=True
# BLOCKCHAIN_ENABLED=True
# GANACHE_URL=http://localhost:7545
# IPFS_ENABLED=True

# 4. 启动后端（首次启动会自动建表、插入 RBAC 种子数据、启动 Ganache/IPFS 连接器）
python main.py

# 5. 新开终端，启动前端
cd ../frontend
npm install
npm run dev
```

## 📡 服务端口

| 服务 | 端口 |
|------|------|
| FastAPI 后端 | 8000 |
| Vite 前端 | 5173 |
| MySQL | 3306 |
| Ganache 测试链 | 7545 |
| IPFS API | 5001 |
| IPFS Gateway | 8080 |

## 👤 演示账号（部署前请全部修改）

| 角色 | 用户名 | 初始密码 | 登录跳转 |
|------|--------|---------|---------|
| 系统管理员 | `admin` | 部署时另行设置 | `/` 首页 |
| 种植户 | `farmer` | 部署时另行设置 | `/` 首页 |
| 质检员 | `inspector` | 部署时另行设置 | `/` 首页 |
| 仓库管理员 | `warehouse` | 部署时另行设置 | `/inventory` |
| 销售人员 | `sales` | 部署时另行设置 | `/sales` |

## ⚠️ 注意事项

1. 确保 MySQL 服务已启动
2. 首次运行需要执行数据库初始化脚本
3. 区块链功能需要启动 Ganache 测试网（可由后端自动启动）
4. IPFS 功能需要启动 IPFS 节点（可由后端自动启动）
5. 生产/参赛环境部署前请务必修改所有账号初始密码，并使用高强度随机 `SECRET_KEY`

## 📝 License

MIT License