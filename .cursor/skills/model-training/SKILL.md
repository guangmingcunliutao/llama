---
name: model-training
description: >-
  Domain map for this model-training monorepo (固定表述纠错 / LlamaFactory / GGUF).
  Use at the start of every session in e:/wsl/llama or this workspace, and when
  changing data generation, train, eval, analyze, quant, experiment runs under
  outputs/, jobs, or model-training.config.json. Read this skill instead of
  scanning the whole repository for product rules and directory layout.
---

# 固定表述纠错仓库

新会话先读本 skill，再只打开当前任务涉及的文件。不要为「项目是干什么的 / 产物写哪」通扫仓库。`pipeline.md` 里的全局路径已过时，以这里为准。

更细的目录表见 [paths.md](paths.md)。

## 产品

从「错词 → 正词」种子生成句对，LoRA 微调底模，做纠错评估，可选量化为 GGUF。

界面中文。配置与 CLI 共用仓库根 `model-training.config.json`（gitignore）。用户在 Windows；PowerShell 不要用 `&&`。

不要主动 commit / push。不要写 `save_total_limit`（会删 checkpoint）。

## 包

| 包 | 职责 |
| --- | --- |
| `packages/core` | 生成、训练启动、评估、量化、实验 run |
| `packages/server` | Fastify `/api` + 任务 Hub |
| `packages/web` | Vite + Ant Design；侧栏来自 `pages/*/menu` |
| `packages/cli` | `pnpm mtrain` |

开发：`pnpm server:dev`（5000；core 只重建 dist，**不**因此重启接口，以免掐掉正在跑的评估/训练）+ `pnpm dev`（5173，`/api` 代理）。改完 core 若要接口立刻加载新代码，等任务空闲后重启 server。打包界面：`pnpm build` 后 `pnpm webui`。

## 实验（唯一产物模型）

全局只有 `outputs/` 一棵树。当前选中写在 `outputs/workspace.json`。

| 类型 | 目录 | 主要产物 |
| --- | --- | --- |
| 数据 `data` | `outputs/data/<id>/` | `train.jsonl`、`eval/eval*.jsonl`、`progress.json` |
| 训练 `train` | `outputs/train/<id>/` | `train.yaml`、`lf/term_sft.jsonl`、`ckpt/` |
| 评估 `eval` | `outputs/eval/<id>/` | 预测、`reports/metrics.json` |

不要再写 `outputs/sft`、`outputs/train`（无 id）、`outputs/lf-predict` 这种单槽位。

三种操作语义（数据、训练共用词；评估也有全新 / 继续未完成）：

| 语义 | 含义 | 目录 |
| --- | --- | --- |
| **fresh** | 全新开始 | 新建 run |
| **resume** | 同一件事从中断处接着做 | **同一** run |
| **continue** | 在上一份结果上再做一轮 | **新建** run，`parentId` |

训练 **resume** 需要 `ckpt/checkpoint-N`。训练 **continue** 需要 LoRA（`ckpt/` 根目录或最新 checkpoint 内的 `adapter_config.json` / `adapter_model.*`）。保存步长太大且中断太早时，两份都不能用——这是缺权重，不是没实现。

评估 **resume** 跳过已经写完的预测切片，并从中断切片已有的 `pred.jsonl` 接着做。LlamaFactory 单切片若完全没落盘，这一片会重跑。

进度条上的「步」是优化步：`ceil(样本数 / (per_device_train_batch_size × gradient_accumulation_steps))`，不是条数。

## 页面链路

```
数据生成 → 训练 → 评估 → 调参 → 量化导出
```

| 页 | 文件 | 做什么 |
| --- | --- | --- |
| 数据 | `packages/web/src/pages/data.tsx` | 上传种子、检索生成；训练集与验证集**分开检索**，句子不重复 |
| 训练 | `train.tsx` | spawn LlamaFactory；可改 `save_steps`（保存步长） |
| 评估 | `eval.tsx` | 加载当前训练实验的 LoRA，对验证集生成并打分 |
| 调参 | `analyze.tsx` | **不跑模型**；读当前评估实验的预测 |
| 量化 | `quant.tsx` | 本机 llama.cpp `llama-quantize`，不是聊天用的 `llama.exe` |

评估切片（在数据实验 `eval/` 下）：

- `eval_seen_pair.jsonl`：词对见过、句子没见过
- `eval_unseen_pair.jsonl`：整组词对未训练
- `eval_keep.jsonl`：本已正确，不该改
- `eval.jsonl`：seen + unseen（不含 keep）

规则基线只是对照上界，不是模型评估。

## 量化

设置里填 **一个工具目录**（官方运行包、Llama.app、或 llama.cpp 编译目录）。在目录 / `bin/` / `build/bin/` / `Contents/MacOS/` 找 `llama-quantize`。

- 已有 `.gguf`：有 quantize 即可
- HuggingFace 目录：还要 `convert_hf_to_gguf.py` + 系统 Python 3.10+（不要 Microsoft Store 占位 `python.exe`）。Windows 官方 zip 通常没有该脚本

LoRA adapter 目录不能直接量化，需先 merge。

## 实现约定

- 长任务走 `packages/server/src/jobs`：同名互斥，不同名可并行。取消必须 `throw JobCancelledError` 或让 Hub 看到 abort，不能当成功返回。
- `Form disabled={locked}` 会禁用内部停止按钮和确认弹层。开始/停止放在 Form 外；`ConfirmDangerButton` 用 `ConfigProvider componentDisabled` 隔离。
- 训练 yaml 由 `trainJob.ts` 按当前 train run 写出；`llamafactory.model` 记住底模路径。
- 改 Web 行为后按用户规则做页面验证（能开浏览器就走主路径）。

## 改代码时先打开

| 任务 | 先读 |
| --- | --- |
| 实验 / 续跑 | `packages/core/src/runs/` |
| 训练启动 | `packages/core/src/trainJob.ts`、`trainSession.ts` |
| 量化 | `packages/core/src/quant.ts` |
| 任务 API | `packages/server/src/jobs/commands.ts`、`hub.ts` |
| 页面 | `packages/web/src/pages/<页>.tsx` |
