# 评审样本与 Prompt Profile 候选

> 目录名 `ax-training` 为历史兼容保留。当前生产链不会在这里训练模型，也不会生成未经评估的准确率。

## 这套工具现在负责什么

1. 从人工评审 API 导出带 `news_id` 和稳定 `fingerprint` 的证据样本。
2. 创建不可变的数据快照，便于追溯输入、人工改写和评分。
3. 从快照中选择少量示例，生成一个 **未评估的 prompt profile 候选**。

它不负责：

- 声称 AX/BootstrapFewShot 已优化生产程序；
- 用训练样本本身计算准确率；
- 自动激活或部署候选配置；
- 把长度合规当作语义质量。

## 安全工作流

```text
稳定内容 fingerprint
  → 人工评审决策
  → 证据快照
  → prompt profile 候选
  → 独立留出集盲评
  → 人工批准
  → 显式发布
```

### 1. 导出评审快照

```bash
bun run scripts/ax-training/export-from-annotation.ts \
  --version=review-20260812 \
  --desc="人工评审样本" \
  --min-score=0 \
  --max-score=100 \
  --tags=review,baseline \
  --by=admin
```

`--version` 是便于操作者识别的标签；快照管理器会生成自己的不可变版本号。

### 2. 创建候选配置

```bash
bun run scripts/ax-training/train-model.ts --version=<snapshot-version>
```

历史命令名仍叫 `train-model.ts`，但产物元数据会明确标记：

- `trained: false`
- `validated: false`
- `evaluationStatus: not-run`

传入 `--deploy` 会失败，防止绕过评估门禁。

### 3. 评估

候选示例和留出集必须按 `fingerprint` 去重并互斥。至少比较：

- 事实一致性：不得增加输入中不存在的实体、数字或因果关系；
- 标题与摘要长度合规；
- 与基线 prompt 的同样本人工盲评偏好；
- 失败率、延迟和每条内容的调用成本。

只有评估报告明确给出样本划分、指标计算方式和通过阈值，候选才可进入人工发布。

## 被禁用的入口

- `activate-version.ts`：始终拒绝直接激活数据快照。
- `POST /api/ax-training/versions/:version/train`：返回 HTTP 410。
- `POST /api/ax-training/versions/:version/activate`：返回 HTTP 410。

Web 工作台的旧 `/training` 地址会跳转到 `/evaluation`。

## 兼容说明

- 持久化任务中的 `ax-optimized` 仍能运行，但只是 `prompt-profile` 的兼容别名。
- 生产 profile 暂时仍位于 `ax-framework/models/production/latest.json`，以避免一次迁移同时修改部署挂载与数据库任务。
- 文件中的 legacy `accuracy`/`finalPerformance` 字段只为读取旧 artifact 兼容，运行时不会展示或信任它们。
