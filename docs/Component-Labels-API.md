# 元器件编号标签 API

> 状态：已上线，v1.21.18 实机验证通过
> 日期：2026-07-18
> 服务地址：`https://quote0.logic.heiyu.space`（生产 news-api，前缀路径即 API 路径）

## 0. 设计原则

本 API **只负责"给一个元件编号字符串 → 渲染一张标签图 → 打印到热敏打印机"**，不存储、不管理任何元件元数据（型号、厂商、封装、库存、价格等）。这些信息由调用方（料号管理系统）自行维护；本服务只认字符串本身。

两层接口，按需选用：

| 层 | 用途 | 适用场景 |
|---|---|---|
| `/api/component-labels` | 无状态即时渲染/打印 | 单次触发、脚本调用、不需要追踪进度 |
| `/api/component-label-batches` | 批次管理（录入→查进度→批量打印） | 界面化操作、一次性提交一批编号、需要展示进度条/逐条状态 |

两层内部渲染逻辑完全共用（`renderOne`/`printOneCode`），行为一致；批次层只是在其上加了一个"任务清单"的管理外壳。

## 1. 标签规格

- 默认尺寸：`label-T20x8-160`（20mm × 8mm，实际打印像素随打印机型号自动换算——比如 B1 Pro 300dpi 会自动出 240×94px，不用调用方关心）
- 字体：`Saira Extra Condensed`（窄体无衬线，仅覆盖大写字母 + 数字，纯 ASCII）
- 排版：左对齐贴边，仅右侧留安全内缩，按编号位数自动缩放字号（越短字号越大，越长自动缩小）
- 编号会被自动转大写、去首尾空白，最长保留 40 字符

## 2. `/api/component-labels`（即时层）

### `POST /api/component-labels/render`

批量渲染编号为标签图。**幂等**：同一编号（同 `targetId`）默认直接复用已渲染结果，不重复生成。

请求：
```json
{
  "codes": ["C25168826", "C2925077"],
  "targetId": "label-T20x8-160",   // 可选，默认 label-T20x8-160
  "force": false                    // 可选，true 强制重新渲染(忽略缓存)
}
```

响应：
```json
{
  "success": true,
  "results": [
    { "code": "C25168826", "labelId": "uuid", "pngUrl": "/api/minio-proxy/labels/xxx.png", "cached": false },
    { "code": "C2925077", "labelId": "uuid", "pngUrl": "/api/minio-proxy/labels/yyy.png", "cached": true }
  ]
}
```
`pngUrl` 是相对路径，需拼服务域名访问：`https://quote0.logic.heiyu.space` + `pngUrl`。

单条渲染失败不影响其他条目，失败项返回 `{ "code": "...", "error": "..." }`（无 `labelId`/`pngUrl` 字段）。

### `POST /api/component-labels/print`

批量打印。未渲染过的编号会自动先渲染。

请求：
```json
{
  "codes": ["C25168826", "C2925077"],
  "deviceId": "niimbot-main",       // 必填，打印设备 id（找管理员要，见 §4）
  "targetId": "label-T20x8-160"     // 可选
}
```

响应：
```json
{
  "success": true,
  "printed": 2,
  "results": [
    { "code": "C25168826", "ok": true, "httpStatus": 200 },
    { "code": "C2925077", "ok": true, "httpStatus": 200 }
  ]
}
```

### `GET /api/component-labels/:code`

查单个编号的渲染/打印状态。

```
GET /api/component-labels/C25168826?targetId=label-T20x8-160
```

响应：
```json
{
  "success": true,
  "code": "C25168826",
  "labelId": "uuid",
  "pngUrl": "/api/minio-proxy/labels/xxx.png",
  "labelStatus": "printed",
  "printCount": 3,
  "printHistory": [{ "printed_at": "...", "device_id": "niimbot-main" }]
}
```
未渲染过的编号返回 `404`。

## 3. `/api/component-label-batches`（批次管理层）

### `POST /api/component-label-batches`

创建批次并录入编号（不会自动渲染，需要另调 `/render` 或 `/print`）。

请求：
```json
{
  "name": "2026-07-18 采购入库批次",
  "codes": ["C25168826", "C2925077", "C5550344"],
  "targetId": "label-T20x8-160"   // 可选
}
```

响应：
```json
{ "success": true, "id": "batch-uuid", "createdAt": "...", "count": 3 }
```

### `GET /api/component-label-batches`

列出所有未归档批次，带进度计数。

响应：
```json
{
  "success": true,
  "batches": [
    {
      "id": "batch-uuid",
      "name": "2026-07-18 采购入库批次",
      "targetId": "label-T20x8-160",
      "status": "draft",              // draft | printing | done | archived
      "counts": { "total": 3, "rendered": 0, "printed": 0 },
      "createdAt": "...", "updatedAt": "..."
    }
  ]
}
```

### `GET /api/component-label-batches/:id`

批次详情，含每条编号的状态。

响应：
```json
{
  "success": true,
  "batch": { "id": "...", "name": "...", "targetId": "...", "status": "...", "createdAt": "...", "updatedAt": "..." },
  "items": [
    {
      "id": "item-uuid", "idx": 0, "code": "C25168826",
      "labelId": "uuid", "pngUrl": "/api/minio-proxy/labels/xxx.png",
      "labelStatus": "approved", "printCount": 0, "lastPrintedAt": null
    }
  ]
}
```

### `POST /api/component-label-batches/:id/render`

渲染批次内所有尚未渲染的条目。可反复调用（幂等，只处理 `labelId IS NULL` 的条目）。

请求：无 body。

响应：
```json
{
  "success": true,
  "rendered": 3,
  "results": [
    { "itemId": "...", "code": "C25168826", "ok": true, "labelId": "uuid" }
  ]
}
```

### `POST /api/component-label-batches/:id/print`

批量打印批次内条目。

请求：
```json
{
  "deviceId": "niimbot-main",          // 必填
  "scope": { "itemIds": ["item-uuid"] } // 可选，不传则打印批次内全部条目
}
```

响应：
```json
{
  "success": true,
  "printed": 3,
  "results": [
    { "itemId": "...", "code": "C25168826", "ok": true, "httpStatus": 200 }
  ]
}
```

## 4. 设备（`deviceId`）

打印目标由 `deviceId` 指定，当前生产环境已注册：

| deviceId | 名称 | 型号 | dpi |
|---|---|---|---|
| `niimbot-main` | niimbot 热敏标签机 | B1 Pro | 300 |

设备 IP 会漂移（DHCP），已经是通过后台数据库动态配置、不需要重新部署代码即可更新——如果打印失败报连接错误，找管理员核对设备当前 IP，不是调用方需要处理的问题。

## 5. 错误处理约定

所有端点失败都返回 `{"success": false, "error": "..."}`，HTTP 状态码：
- `400` — 参数错误（缺 `codes`/`deviceId`，或设备类型与标签尺寸不匹配）
- `404` — 批次/设备/编号不存在
- `500` — 服务端异常（渲染失败/数据库错误等，`error` 字段有具体信息）

批量接口（`/render`、`/print`）里**单条失败不会导致整个请求失败**，调用方要检查 `results` 数组里每一条的 `ok`/`error` 字段，不能只看外层 `success`。

## 6. 典型调用流程

**一次性打印几个编号（不需要进度追踪）**：
```
POST /api/component-labels/print { codes: [...], deviceId: "niimbot-main" }
```

**批量录入 + 界面展示进度 + 后续打印**：
```
1. POST /api/component-label-batches { name, codes }        → 拿到 batchId
2. POST /api/component-label-batches/:id/render               → 触发渲染，可轮询 GET /:id 看进度
3. GET  /api/component-label-batches/:id                      → 展示每条的 pngUrl 预览
4. POST /api/component-label-batches/:id/print { deviceId }   → 批量打印
5. GET  /api/component-label-batches                          → 列表页看 counts.printed 进度
```
