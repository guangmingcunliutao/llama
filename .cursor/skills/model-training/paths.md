# 路径速查

相对仓库根。`<id>` 形如 `20260903-142347-wx`。

## 运行时（不提交）

| 路径 | 作用 |
| --- | --- |
| `model-training.config.json` | Web/CLI 共用配置 |
| `data/term_pairs.jsonl` | 词对字典 |
| `cache/` | 检索缓存 |
| `outputs/workspace.json` | 当前 data/train/eval 指针 |
| `outputs/data/<id>/train.jsonl` | 该次数据实验的训练集 |
| `outputs/data/<id>/eval/` | 验证切片 |
| `outputs/train/<id>/train.yaml` | 该次训练 yaml |
| `outputs/train/<id>/lf/term_sft.jsonl` | 拷给 LlamaFactory 的数据 |
| `outputs/train/<id>/ckpt/` | checkpoint 与最终 LoRA |
| `outputs/eval/<id>/` | 评估预测与指标 |

## 源码

| 路径 | 作用 |
| --- | --- |
| `packages/web/src/pages/` | 页面；`export const menu` 生成侧栏 |
| `packages/web/src/jobs/` | 任务轮询与 cancel |
| `packages/core/src/runs/paths.ts` | run 目录约定（真相） |
| `packages/core/src/runs/store.ts` | run.json / 列表 / canResume |
| `packages/core/src/runs/trainSession.ts` | fresh / resume / continue |
| `LlamaFactory/` | 本机安装的训练框架（数据根旁） |
| `finetune/` | 训练用 Python 虚拟环境 |

## 过时文档

`pipeline.md`、部分旧注释仍写 `outputs/sft`、`outputs/train`、`outputs/lf-predict`。新代码一律用上面的 run 目录。
