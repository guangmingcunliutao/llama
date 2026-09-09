# 路径速查

相对仓库根。`<id>` 形如 `20260908-134219-test1`。

## 运行时（不提交）

| 路径 | 作用 |
| --- | --- |
| `model-training.config.json` | Web/CLI 共用配置 |
| `data/term_pairs.jsonl` | 词对字典 |
| `cache/` | 检索缓存（`--no-cache` / 勾选可跳过读取） |
| `outputs/workspace.json` | 当前 data/train/eval 指针 |
| `outputs/data/<id>/` | 数据实验根；同时作为 WebUI `dataset_dir` |
| `outputs/data/<id>/train.jsonl` | 训练集（alpaca 字段） |
| `outputs/data/<id>/dataset_info.json` | `term_train` / `term_eval`，生成后写出 |
| `outputs/data/<id>/manifest.json` | 导出指纹（可选） |
| `LlamaFactory/llamaboard_config/*.yaml` | 生成后同步 `train.dataset_dir` |
| `outputs/lf-runs/<id>/` | 每次训练的 `output_dir`（空目录先建好） |
| `outputs/lf-runs/<id>/training_args.yaml` | 训完后的超参真相 |
| `outputs/lf-runs/<id>/llamaboard_config.yaml` | WebUI 控件快照 |
| `outputs/lf-meta/<id>.json` | 本仓库登记（dataRunId、指纹、备注） |
| `outputs/lf-meta/webui.pid.json` | 本机拉起的 WebUI 进程记录 |
| `outputs/eval/<id>/lf-predict/` | Evaluate 输出目录 |
| `outputs/eval/<id>/infer/pred.jsonl` | 导入后的本仓库预测 |
| `outputs/swanlog/` | SwanLab local 日志 |
| `outputs/train/<id>/` | 旧代训（保留） |
| `outputs/reports/` | 调参报告 / compare / best |

## LlamaFactory 安装旁（相对 LF 工作目录）

| 路径 | 作用 |
| --- | --- |
| `LlamaFactory/llamaboard_cache/user_config.yaml` | 语言、上次模型；**无**训练超参 |
| `LlamaFactory/llamaboard_cache/ds_*.json` | DeepSpeed 模板 |
| `LlamaFactory/llamaboard_config/` | 用户手动「保存配置」 |

## 源码

| 路径 | 作用 |
| --- | --- |
| `packages/web/src/pages/` | 页面；`export const menu` 生成侧栏 |
| `packages/web/src/ui/LfHandoffCard.tsx` | 数据页：打开 LF / SwanLab / 评估折叠 |
| `packages/core/src/lfHandoff.ts` | 导出、占坑、扫描 artifacts |
| `packages/core/src/lfServices.ts` | 按需拉起 webui / swanlab watch |
| `packages/server/src/routes/lf.ts` | `/api/lf`、export、prepare、webui、score |
| `packages/core/src/runs/paths.ts` | run 目录约定（真相） |
| `docker/` | 单容器：Web + LF WebUI + 可选 SwanLab |

## 过时文档

`pipeline.md`、部分旧注释仍写独立训练/评估页、`outputs/sft`、本仓库 spawn 主训。新代码以本文件与 [SKILL.md](SKILL.md) 为准。
