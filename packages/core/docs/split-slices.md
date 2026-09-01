# 评估切片：seen / unseen / keep

`split` 会把语料划成训练集与三类评估集，避免「同一句既训练又评估」，并分别衡量不同能力。

## 总览

| 文件 | 配置键 | 测什么 |
| --- | --- | --- |
| `eval/eval_seen_pair.jsonl` | **seen** | 词对在训练里**见过**，句子**没见过** |
| `eval/eval_unseen_pair.jsonl` | **unseen** | 整组词对**完全没进训练** |
| `eval/eval_keep.jsonl` | **keep** | 句子**本来就正确**，模型不应乱改 |
| `eval/eval.jsonl` | eval | seen + unseen 合并（**不含** keep） |

导出到 LlamaFactory 时通常命名为 `*_eval_seen`、`*_eval_unseen`、`*_eval_keep`、`*_eval`。

---

## eval_seen（seen_pair）

**作用：** 测「同词对、不同上下文」的纠错能力。

**怎么抽：**

- 某个「错误词 → 正确词」在语料里至少 `split.minPairSizeForSeenEval` 条（默认 2）时，才参与 seen 评估。
- 从中留出约 `split.seenPairEvalRatio`（默认 10%）的**句子**进评估，其余进训练。
- 至少保留 1 条同词对样本在训练里。

**例子：** 训练里见过「习总书记 → 习近平总书记」的若干句，评估句是另一篇里的不同句子，但仍是同一词对。

**解读：** seen 分数高，说明模型学会了「这个词该怎么改」，而不只是背某一句。

---

## eval_unseen（unseen_pair）

**作用：** 测对**从未见过**的错误模式的泛化。

**怎么抽：**

- 按 `error_type` 分层，约 `split.unseenPairRatio`（默认 10%）的**词对整组**不进训练，全部进评估。
- 同一正句若会泄漏到训练侧，会从训练里剔除（见 `reports/split.json` 的 `dropped_*_leakage`）。

**例子：** 「服装设计 → 服装设计师」整组词对从未出现在训练里，评估专门看模型能不能改对。

**解读：** unseen 分数明显低于 seen，通常表示模型在「背训练句」而非学规则；应优先看 unseen。

---

## eval_keep（keep）

**作用：** 测**过度编辑**——本来没问题的句子，模型会不会乱改。

**怎么抽：**

- 从训练池里抽已是规范句的样本，设 `input = output`（无需纠错）。
- 数量约 `split.keepRatio × 训练条数`，上限 `split.maxKeep`。

**例子：** 输入与金标都是「李文先生：您好！」，理想预测应原样返回。

**解读：**

- `copy_input_rate` 高在这里通常是**好事**（没乱改）。
- 若 keep 上模型仍大改，说明容易「见句必改」，需加 keep 样本训练或调 instruction。

---

## 泄漏控制

划分时会保证：

1. **同一正句**不会同时出现在训练集和 seen/unseen 纠错评估里。
2. unseen 词对的正句不会出现在训练里。
3. 每条样本有稳定 `id`，`infer` / `evaluate` 按 id 对齐。

详细计数见 `outputs/reports/split.json`。

---

## 相关命令

```bash
mtrain split
mtrain suite          # split + 规则基线 infer + evaluate
mtrain infer --all    # 对四个 eval 文件各推理
mtrain evaluate --all
mtrain generate-eval  # 独立检索验证集，不从 train 剥离
```

LlamaFactory 训练后可用 `mtrain analyze` 读 predict 产物；业务切片需分别改 yaml 里的 `eval_dataset` 再 predict。
