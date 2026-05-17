# ADR-0002：多目标渲染抽象与热敏标签机泛化

- **状态（Status）**：Accepted — Phase A 待实施
- **日期（Date）**：2026-05-17
- **决策者**：lcolok + Claude（指挥官模式）
- **相关变更**：feature/image-sender-module 分支，承接 ADR-0001 中预告的"标签机集成"长期方向

---

## 1. 上下文（Context）

### 1.1 触发事件

2026-05-17 用户提出把 quote0-mcp 的渲染内核泛化以支持热敏标签机打印。
控制端固件（基于 ESP32-C3 + BLE 转 Niimbot 协议）已实现在 `/Users/friday/github/esp32-health-station/src/apps/niimbot`，
首批目标尺寸 SKU `T40x20-320`：40×20 mm，203 dpi（8 dots/mm），320×160 px，单色 1-bit。

### 1.2 既有设计的局限性

当前 quote0-mcp 渲染内核为 296×152 单一 EINK 设备深度耦合：

- `src/react-widgets/core/device-constants.ts` 仅导出裸常量 `EINK_DEVICE_WIDTH/HEIGHT`，无 dpi/色彩/物理尺寸等元数据
- 多个 widget 直接 import 该常量当尺寸（v1.0.36 已统一）；但部分（`MaximizedWeatherWidget` / `SmartMaximizedWeatherWidget`）仍硬编码 296×152 字面量
- `FontLoader` 仅加载 Fusion Pixel 8/10/12px 像素字体一组，专为低 dpi EINK 复古视觉设计
- `RenderingRegistry`（`src/react-widgets/core/rendering-modules.ts:890`）已是注册表派发结构，但 4 个现有 renderer 都隐含"输出 296×152 推 EINK"假设
- `content_inventory` 表无 `target_id` 列，producer 写入时与最终输出设备的绑定靠 `producer_job_id` 间接关联

### 1.3 niimbot 控制端的现状与 ESP32-C3 资源约束

niimbot 固件当前对外仅暴露 `POST /api/print/url`（板子主动拉 URL → libpngle 解码 PNG → Atkinson/Floyd-Steinberg dither → 1-bit packed → BLE 喂打印机）。
该路径对 ESP32-C3 三重压力过大：

| 资源 | C3 上限 | URL pull 模式占用 |
|---|---|---|
| SRAM | ~400 KB（实际可用 ~200 KB） | HTTP 下载 buffer + libpngle 解码缓存 + dither 行缓冲 |
| Flash | 通常 4 MB | libpngle 静态体积 + dither 算法 + WiFi/HTTP 栈 |
| CPU | RISC-V 单核 160 MHz | dither 全图扫描（320×160 = 51200 px）+ PNG 解压 |

把这三件事全交给 quote0 容器做（资源近乎无限），niimbot 只接收已处理的 6400 字节（320×160/8）raw bitmap → 直接喂 BLE，是更合理的责任划分。

### 1.4 与未来产品方向的关系

quote0-mcp 长期方向是**多设备内容生产+分发中心**（ADR-0001 §1.3 已记录）。
本 ADR 落地后，新增第 N+1 种物理设备的工程量将稳定化：抽象就位的前提下，新设备 = 1 个 RenderTarget 注册 + 1 个 Renderer + 1 个 Push 适配器，不再触及核心渲染流水线。

---

## 2. 关键设计抉择（Key Design Choices）

### 2.1 Push 模式 vs Pull 模式（决策：Push）

| 模式 | Pull（板子拉 URL） | Push（服务端推 bytes） |
|---|---|---|
| 服务端职责 | 渲染 PNG + 上传 MinIO + 返回 URL | 渲染 PNG + dither + 1-bit 打包 + POST raw bytes |
| 板端职责 | HTTP 下载 + libpngle 解码 + dither + BLE | 接收 bytes + BLE |
| ESP32-C3 友好 | ❌ 三重资源压力 | ✅ 仅接收 6.4 KB 入队 |
| 网络往返 | 板 → MinIO 一跳（DNS/TLS/带宽各一份压力） | quote0 → 板 直推 一跳 |
| 失败重试位置 | 板端 | 服务端（资源充裕） |
| 与现有 EINK 推送链路一致性 | 不一致 | 一致（`LocalEinkRenderingModule` 已是 push 1-bit 模式） |

**决策**：采用 Push 模式。沿用 quote0 推 EINK 设备已验证的"服务端转 1-bit → POST"模式，仅终端节点（IP/路径）和适配字节序换成 Niimbot 端。

### 2.2 触发模式：REST on-demand 单一入口（不走 scheduler）

新闻/天气场景是**周期推送**（每分钟/每半小时），所以需要 producer/consumer + content_inventory。
标签场景是**事件驱动**（用户在收纳/分拣时按需打印一张），不属于周期更新。

**决策**：标签机走纯同步 RPC，**不**复用 content_inventory / producer / scheduler。
端点形态：`POST /api/labels/print` → 同步渲染 → 同步推 niimbot → 返回 `print_id`。
未来若出现"批量打印"需求，再单独评估是否引入队列（niimbot 端的 FreeRTOS queue 已经是最末端 backpressure，绝大多数场景够用）。

### 2.3 网络拓扑：容器 host 网络 + 固定 LAN IP

| 候选路径 | 评估 |
|---|---|
| 容器 → `niimbot.local` mDNS | docker bridge 默认不传 mDNS 广播，需要 mdns relay |
| 容器 → 固定 LAN IP | 路径最短最稳，需要 ESP32 端做静态 DHCP 或硬编码 |
| 容器 → 懒猫反代 | 多一跳，配置复杂 |

**决策**：lzc-manifest 给 niimbot push 调用配 `network_mode: host`，niimbot ESP32 端在路由器做静态 DHCP 绑定（或固件层硬编码备用 IP）。地址通过 DB 表 `render_targets.push_endpoint` 配置，可热更换。

### 2.4 字体策略：可扩展 OTF 注册表 + 多字体 fallback 链

用户明确说"字体可选择很多种，通过 otf 等格式可以不断补充"。

**决策**：
- `assets/fonts/` 下按子目录组织字体族（如 `fonts/source-han-sans/` / `fonts/pmzd-quanlai/` / `fonts/oppo-sans/`）
- 启动时扫描目录注册到 `FontRegistry`，每个字体族暴露 `{ familyName, files: { weight, style, path } }`
- `RenderTarget` 新增 `defaultFontStack: string[]` 字段（如 `['source-han-sans', 'inter']` —— CJK 字体优先，西文 fallback）
- LabelContent 可指定 `fontFamily` override 默认
- satori loadFonts 按需懒加载，避免启动时一次性加载所有字体到内存

字体策略与渲染目标解耦：EINK target 继续指向 Fusion Pixel 字体栈，标签 target 指向高 dpi 字体栈，调用方无需关心切换。

### 2.5 RenderTarget 配置：DB 表 vs JSON 配置

| 方案 | 优点 | 缺点 |
|---|---|---|
| 内存常量数组 | 极简 | 改动需重新部署 |
| JSON 配置文件 | 简单可改 | 容器内文件路径管理麻烦 |
| DB 表 + 管理 UI | 与 LLM slot / scheduler jobs 现有架构一致；annotation-web 可加管理页 | 工程量略大 |

**决策**：与 LLM slot 和 scheduler jobs 保持一致，使用 DB 表 `render_targets`。
Phase A 阶段先种子 2 条不暴露 UI（手 INSERT 即可），Phase C 阶段如有需要再加 RenderTargetsPage。

### 2.6 单大字中英混排的实现路径

用户首要场景：单大字标题，中英文混排。

**决策**：`LabelWidget` 第一版极简：
- props: `{ title: string; subtitle?: string; fontFamily?: string; target: RenderTarget }`
- 单 flex 容器全屏居中
- **自适应字号**：二分查找最大字号使文本不溢出 target.widthPx × target.heightPx 边界（限制最多 2 行换行）
- **中英 fallback**：satori 接受 fonts 数组，按 unicode 范围自动选字体（中文走 CJK 字体，西文走西文字体）

后续场景（商品价签、物料标签等）作为 LabelWidget 的不同 layout 模板演进，不影响第一版接口。

---

## 3. 决策（Decision）

### 3.1 选定方向：三阶段渐进实施

| Phase | 范围 | 工程量 | 是否触及 niimbot 固件 |
|---|---|---|---|
| **Phase A** | RenderTarget 抽象 + DB 表 + 老 widget 适配 + 既有 EINK 链路验证 | 1 轮 Kimi（quote0 后端 + DB） | 否 |
| **Phase B** | LabelWidget + ThermalLabelRenderingModule + NiimbotPushModule + ESP32-C3 `/api/print/raw` 端点 | 1 轮 Kimi（quote0） + 1 轮 Kimi（ESP32 C++） | **是** |
| **Phase C** | `POST /api/labels/print` REST 端点 + FontRegistry 多字体加载 + 用户首要场景"单大字中英混排"打通 | 1 轮 Kimi | 否 |

### 3.2 关键约束（all phases）

- ESP32-C3 板端代码必须**轻量**（不引入 PNG/dither/HTTP 下载新依赖），Phase B 中 C3 固件改动以"删代码 > 加代码"为优先
- 不破坏既有 EINK 推送链路（v1.0.37 生产中的 producer/consumer + 新闻+天气）
- 沿用 ADR-0001 PATCH 端点风格（如 render_targets 配置变更端点）
- 沿用 DB-driven LLM slot 模式（多目标动态切换无需重新部署）

### 3.3 拒绝方案：在现有 EINK 路径上 monkey-patch

理由：device-constants.ts 沉淀的"单一真理源"原则（v1.0.36 已记入文件注释）刚立起来，monkey-patch 一旦放行就回到 v1.0.34 时代 640/384 vs 296/152 的混乱。**抽 RenderTarget 是一次性偿还的债，不是新增的债。**

---

## 4. 后果（Consequences）

### 4.1 正面

- 新增 N+2 种设备（标签机、未来的桌面屏、彩色 EINK 等）工程量稳定化，不再触及核心流水线
- 字体扩展从"修代码"降级到"丢文件 + 重启"
- ESP32-C3 niimbot 固件路径简化，去除 libpngle 依赖后 Flash 占用可下降（具体值待 Phase B 测量）
- 设计文档先于代码沉淀，避免 v1.0.34-35 那类"边写边发现尺寸错"的反复 patch 循环

### 4.2 负面/风险

- Phase A 必须迁移所有现存 widget 才能保证类型安全，部分老 widget（`MaximizedWeatherWidget` 等含硬编码 296×152）触碰风险高于平均
  - 缓解：Phase A Kimi prompt 中明列哪些 widget 必改、哪些保持现状、禁区清单
- 字体懒加载若实现不当，首次请求延迟会突然飙升
  - 缓解：Phase C 中加 startup warmup（启动时预加载 RenderTarget.defaultFontStack 指向的字体）
- ESP32-C3 端 BLE transport 已知 320×160 边界稳定性问题（handoff §4 注释提及），Phase B 改动需保留现有 MTU=247 + 15ms interval 硬优化
  - 缓解：Phase B Kimi prompt 强制要求保留 BLE transport 模块 untouched
- LAN IP 硬编码方案不抗 DHCP 重新分配
  - 缓解：Phase B 中 niimbot 端实现"启动时主动注册到 quote0"的回调（板子启动后 POST 一次 `/api/render-targets/heartbeat` 上报当前 IP），DB 自动更新

### 4.3 度量是否成功的信号

- Phase A 完成：`grep -rn "296\|152" src/react-widgets/components` 应只剩 `MaximizedWeatherWidget` 系列（受控冻结）或注释；其他 widget 全部走 `target.widthPx/heightPx`
- Phase B 完成：服务端可独立测试通过 `curl -X POST http://niimbot-ip/api/print/raw --data-binary @test.bin` 触发实际打印
- Phase C 完成：用户通过 ESP32 健康站点（或任意 HTTP 客户端）调一次 `POST /api/labels/print` 在 5 秒内拿到标签机出纸

---

## 5. 替代方案（Alternatives Considered）

### 5.1 让 niimbot 板子继续做 dither（保留 pull 模式）

利用现有 `POST /api/print/url` 直接对接 quote0。**拒绝**——见 §1.3 资源压力分析。即使 C3 能跑通，质量受限于 C3 计算能力，且 BLE 稳定性问题（handoff §4）排查面更大。

### 5.2 引入独立的"标签机服务"项目

把标签机相关代码隔离到新 repo。**拒绝**——浪费 quote0 已有的 satori + FontLoader + RenderingRegistry + DB 基础设施，且与"多设备内容生产+分发中心"长期愿景背道而驰。

### 5.3 用 ImageMagick / 系统级工具替代 satori 做标签渲染

ImageMagick 字体排版能力强但 API 复杂，且不复用 React 组件树这套描述形式（标签 layout 复杂化时复用价值低）。**拒绝**——保持 satori 单一技术栈。

### 5.4 短期方案：Phase C 跳过 RenderTarget 抽象（直接硬编码 320×160 第二套常量）

类似 ADR-0001 中拒绝的方案 ①。**拒绝**——技术债，下次第三种设备出现又得重来。

---

## 6. Phase A 实施清单

```
1. 创建 src/react-widgets/core/render-targets.ts
   - interface RenderTarget { id, kind, widthPx, heightPx, dpi, colorMode, physical?, defaultFontStack, pushEndpoint? }
   - export const EINK_TARGET: RenderTarget = { ... 296×152 ... }
   - 旧的 EINK_DEVICE_WIDTH/HEIGHT/EINK_DEVICE_SIZE_LABEL 改为从 EINK_TARGET 派生（backward compat）

2. DB schema 加表 render_targets
   - 列：id (PK), kind, width_px, height_px, dpi, color_mode, default_font_stack jsonb, push_endpoint, physical_w_mm, physical_h_mm
   - createTablesSQL 加 CREATE TABLE + INSERT 2 条种子（eink-296x152, label-T40x20-320）
   - requiredTables 抽取（v1.0.36 已自动化）自动识别新表

3. 迁移 widgets（仅迁移正在生产中使用的）
   - SatoriNewsWidget: props 接 target?: RenderTarget，默认 EINK_TARGET
   - SatoriWeatherWidget: 同上
   - MiniWeatherWidget / CompactWeatherWidget / EnhancedMiniWeatherWidget: 同上
   - MaximizedWeatherWidget / SmartMaximizedWeatherWidget: 冻结状态，仅备注 // FROZEN: 不迁移，下次重写
   - NewsWidget (puppeteer legacy): 冻结

4. 渲染流水线接 target
   - satori-renderer.ts: 接收 target，宽高从 target 取
   - rendering-modules.ts: 各 renderer 透传 target

5. 验收
   - bun run build (TypeScript) 通过
   - 现有 EINK 推送链路冒烟：multi-source-rotation producer 跑一次，inventory 入图仍为 296×152
   - 现有 weather-guangzhou 推送一次，设备显示无变化
   - DB 验证：SELECT * FROM render_targets; 应返回 2 条
```

---

## 7. 修订记录

- **2026-05-17**：v1 创建，决策 Phase A 待实施 + Phase B/C 路线图
