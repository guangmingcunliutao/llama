# 固定表述纠错 · 训练 / 评估 / 推理

这里只负责 LlamaFactory 微调示例。句对、评估集、指标都由 `wx/` 里的 `termcorr` 生成。

**整条链路、以及训练目录不在本仓库时怎么对接**：见仓库根目录 [`pipeline.md`](../pipeline.md)。

通用语法纠错数据（例如旧的 `history/train.json`）不要和这份固定表述数据混训。

---

## 流水线

```
prepare  →  generate  →  suite(split+基线评估)  →  训练  →  API 推理  →  evaluate --all
```

在工作目录 `E:/llama/termcorr-work`：

```bash
# 1. 全量生成（若已在跑，等它结束）
node E:/llama/wx/bin/termcorr.js generate

# 2. 建设评估集 + 规则基线打分
node E:/llama/wx/bin/termcorr.js suite
```

`suite` 会写出：

| 文件 | 用途 |
| --- | --- |
| `outputs/splits/train.jsonl` | 训练（Alpaca） |
| `outputs/eval/eval_seen_pair.jsonl` | 见过词对、新句子 |
| `outputs/eval/eval_unseen_pair.jsonl` | 从未训练的词对 |
| `outputs/eval/eval_keep.jsonl` | 已规范句，不应改动 |
| `outputs/eval/eval.jsonl` | seen + unseen 纠错评估全集 |
| `outputs/reports/split.json` | 评估集建设报告（规模、泄漏、类型分布） |
| `outputs/reports/metrics.json` | 规则基线指标 |
| `outputs/reports/scored.jsonl` | 逐条对错 |

看评估集是否建好：打开 `reports/split.json`，确认 `eval_seen_pair`、`eval_unseen_pair`、`eval_keep` 都大于 0。规则基线在纠错集上 `exact_match` 应接近 1。

---

## 评估集在测什么

| 切片 | 问题 |
| --- | --- |
| seen | 这个词对训练见过，换个句子还会不会改 |
| unseen | 这个词对训练没见过，会不会泛化 |
| keep | 句子已经规范时，会不会乱改 |

指标含义见 `wx/README.md` 的 `evaluate`。重点看：

- **seen / unseen 的 `term_fix_rate`**：有没有把目标词改对
- **`over_edit_rate`**：是不是改多了
- **`copy_input_rate`**：是不是原样复述错句
- **keep 的 `exact_match`**：规范句是否保持不动

训练后对比规则基线：把 `metrics.json` 里模型分数和 `suite` 留下的基线分数并排看。基线知道 wrong/correct，是上界；模型只能看句子。

---

## 微调

`dataset_info.json` 已指向 `termcorr-work/outputs/splits/train.jsonl`（相对 `train/llamafactory`）。**先跑完 `suite`**，确认该文件存在。

请改这些路径后再训：

- `model_name_or_path`：基座模型
- `output_dir` / `adapter_name_or_path`：训练输出（不要写进 `wx/`）
- `dataset_dir`：本目录 `train/llamafactory`（相对你执行 `llamafactory-cli` 时的 cwd）

LlamaFactory 配置里的 `val_size` 只是训练过程损失，**正式指标一律用 termcorr evaluate**，不要拿它当业务评估。

```bash
llamafactory-cli train train/llamafactory/train_sft.yaml
```

---

## 模型推理与评估

起 OpenAI 兼容服务：

```bash
llamafactory-cli api train/llamafactory/api.yaml
```

工作区 `termcorr.config.js` 里 `infer.http.url` 默认 `http://127.0.0.1:8000/v1/chat/completions`。然后：

```bash
cd E:/llama/termcorr-work
node E:/llama/wx/bin/termcorr.js infer --backend http --all
node E:/llama/wx/bin/termcorr.js evaluate --all
```

交互试用：

```bash
llamafactory-cli chat train/llamafactory/infer.yaml
```
