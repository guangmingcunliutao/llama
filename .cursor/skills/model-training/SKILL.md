---
name: model-training
description: >-
  Domain map for this model-training monorepo (固定表述纠错 / LlamaFactory WebUI /
  GGUF). Use at the start of every session in this workspace, and when changing
  data generation, LF handoff, eval scoring, analyze, quant, outputs/, jobs, or
  model-training.config.json. Read this skill instead of scanning the whole repo.
---

# 固定表述纠错仓库

新会话先读本 skill，再只打开当前任务涉及的文件。不要为「项目是干什么的 / 产物写哪」通扫仓库。`pipeline.md` 与部分旧注释已过时，以这里为准。

更细的目录表见 [paths.md](paths.md)。

## 产品

从「错词 → 正词」种子生成句对，交给 **LlamaFactory WebUI** 做 LoRA 训练/Evaluate，再在本仓库打纠错分、对比超参，可选量化为 GGUF。

界面中文。配置与 CLI 共用仓库根 `model-training.config.json`（gitignore）。用户在 Windows；PowerShell 不要用 `&&`。

不要主动 commit / push。不要写 `save_total_limit: 1`（会只留最后一个 checkpoint）。

## 分工（主路径）

| 谁 | 做什么 |
| --- | --- |
| 本仓库 | 数据生成/导入、导出 `outputs/lf`、占坑 `lf-runs`+`lf-meta`、拉起 WebUI/SwanLab、导入预测打分、调参对比、量化 |
| LlamaFactory WebUI | 选模、改超参、训练、Evaluate 出 `generated_predictions.jsonl` |
| SwanLab local | 只看 loss/GPU；**不当选参依据** |

旧代训 `mtrain train` / `/api/jobs/train` **保留但不做界面**。没有独立「训练」「评估」侧栏页；入口在数据页 `LfHandoffCard`。

## 包

| 包 | 职责 |
| --- | --- |
| `packages/core` | 生成、`lfHandoff`/`lfServices`、评估打分、量化、run |
| `packages/server` | Fastify `/api` + 任务 Hub；`/api/lf/*` 交接 |
| `packages/web` | Vite + Ant Design；侧栏来自 `pages/*/menu` |
| `packages/cli` | `pnpm mtrain` |

开发：`pnpm server:dev` 会**先** `core build` 再并行 watch（避免清空 `dist` 导致 `ERR_MODULE_NOT_FOUND`）+ `pnpm dev`（5173）。打包：`pnpm build` 后 `pnpm webui`。

## 磁盘约定

全局只有 `outputs/` 一棵树。当前选中写在 `outputs/workspace.json`。

| 类型 | 目录 | 说明 |
| --- | --- | --- |
| 数据 | `outputs/data/<id>/` | `train.jsonl`、`eval/eval*.jsonl` |
| LF 数据集 | `outputs/data/<id>/` | WebUI `dataset_dir`：生成时写 `dataset_info.json`，并同步 `llamaboard_config` 的 `train.dataset_dir`（不另拷 `outputs/lf`） |
| LF 训练 | `outputs/lf-runs/<id>/` | WebUI `output_dir`；主键是这个文件夹 |
| LF 登记 | `outputs/lf-meta/<id>.json` | **禁止**放进 `output_dir`（LF 可能清空） |
| 评估 | `outputs/eval/<id>/` | `lf-predict/`、`infer/pred.jsonl`、`reports/metrics.json` |
| 旧代训 | `outputs/train/<id>/` | 保留；列表里 id 前缀 `legacy:` |
| SwanLab | `outputs/swanlog/` | `swanlab watch` 日志目录 |

配置字段：`llamafactory.datasetDir` → `lfExportDir`（WebUI 导出），与旧代训的 `lfDatasetDir`（`train/<id>/lf`）**分开**。

## LlamaFactory 落盘（不要盯错目录）

WebUI 工作目录旁的 `LlamaFactory/llamaboard_cache/`：

- `user_config.yaml`：语言、上次模型、`path_dict`（**不是** lr/epoch）
- `ds_z*.json`：DeepSpeed 模板

超参真正写入 **`output_dir`**（点开始训练后）：

- `training_args.yaml`
- `llamaboard_config.yaml`

手动「保存配置」才写到 `LlamaFactory/llamaboard_config/`。联动本仓库应扫 `lf-runs/<id>/`，不要指望 `llamaboard_cache` 有完整超参。

## 页面链路

```
数据生成（含打开 LF / 评估折叠）→ 调参 → 量化导出
```

| 页 | 文件 | 做什么 |
| --- | --- | --- |
| 数据 | `data.tsx` + `ui/LfHandoffCard.tsx` | 生成/导入；导出 lf；拉起 WebUI；准备评估目录；导入预测打分 |
| 调参 | `analyze.tsx` | 读预测算综合分；无 `pred` 不得用 eval_loss 顶替 |
| 量化 | `quant.tsx` | `llama-quantize`；LoRA 需先 merge |

综合分：`0.35*ROUGE-L + 0.25*BLEU-4 + 0.25*exact_match + 0.15*(1-copy_input)`。

数据检索默认读 `cache/`；勾选「不读取检索缓存」或 `mtrain generate --no-cache`。

评估跟 `lf-meta` 绑的 `dataRunId`，不要用工作区「当前最新数据」。训练与评估抢同一 GPU。

## 实现约定

- 交接核心：`packages/core/src/lfHandoff.ts`、`lfServices.ts`；路由 `packages/server/src/routes/lf.ts`。
- 长任务走 `jobs/`：同名互斥。取消必须 abort，不能当成功。
- `Form disabled={locked}` 会禁用内部停止按钮；开始/停止放 Form 外。
- Docker：单容器 `docker/compose.yaml`，宿主机浏览器开 `127.0.0.1:5000/7860/5092`；容器内路径 `/data/outputs/...`，不要把 `E:\` 填进容器 Gradio。
- 改 Web 行为后按用户规则做页面验证。

## 改代码时先打开

| 任务 | 先读 |
| --- | --- |
| LF 交接 / 占坑 | `lfHandoff.ts`、`lfServices.ts`、`routes/lf.ts`、`LfHandoffCard.tsx` |
| 实验 / 续跑 | `packages/core/src/runs/` |
| 旧代训 | `trainJob.ts`（勿当主路径 UI） |
| 打分 / 导入预测 | `evaluate.ts`、`inferLf.ts`（`importLfPredictions`） |
| 量化 | `quant.ts` |
| 任务 API | `jobs/commands.ts`、`hub.ts` |
| 页面 | `packages/web/src/pages/<页>.tsx` |
