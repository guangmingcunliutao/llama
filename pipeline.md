# 固定表述纠错：数据 → 训练 → 评估 → 调参 → 导出

本仓库在根目录启动 Web 或 CLI（`pnpm webui` / `pnpm mtrain`）。数据写到仓库根 `outputs/`。

## 两步不要混

| 页面 | 问的问题 | 做什么 | 读什么 / 写什么 |
| --- | --- | --- | --- |
| **评估** | 训练后的模型改得对不对？ | 加载 LoRA，在验证集上生成，算纠错指标 | 读 `outputs/train` + `outputs/eval`；写 `outputs/infer/pred*.jsonl`、`reports/metrics.json`、`outputs/lf-predict` |
| **调参** | 下一轮超参怎么改？ | **不跑模型**。读预测目录里的 json/jsonl，出建议、做多轮对比 | 默认读 `outputs/lf-predict`（评估刚写的）；写 `reports/analysis.md`、`reports/best/` |

评估看 **seen / unseen / keep** 业务分。调参看 loss、BLEU/ROUGE、建议 yaml。不要把训练 checkpoint 目录（`outputs/train`）当成调参输入，那里通常没有 `generated_predictions.jsonl`。

## 链路

```
Excel / CSV 种子
    │  数据页上传（prepare）
    ▼
词对字典          data/term_pairs.jsonl
    │  生成训练集（generate）
    ▼
训练集            outputs/sft/train.jsonl
    │  独立检索验证集（generate-eval，句子不与训练重复）
    ▼
验证集            outputs/eval/eval*.jsonl
    │  训练页（llamafactory-cli train）
    ▼
LoRA              outputs/train
    │  评估页（用训练模型 predict + 打分）
    ▼
纠错分数          reports/metrics.json
预测目录          outputs/lf-predict
    │  调参页（读预测目录，不跑模型）
    ▼
超参建议          reports/analysis.md、reports/best/
    │  量化页（可选）
    ▼
GGUF 等
```

规则替换基线只是评估页上的对照按钮，用来估计「如果已经知道错词该改成什么」的上界，**不是**模型评估。

---

## 各步产物

工作区即仓库根，命令：

```bash
pnpm mtrain <命令>
```

| 步骤 | 命令 | 产物 | 作用 |
| --- | --- | --- | --- |
| 洗字典 | `prepare --input 那个.xlsx --force` | `data/term_pairs.jsonl` | 错误词/正确词，一对多会写成多条 |
| 生成句对 | `generate` | `outputs/sft/train.jsonl` | `input`=错句，`output`=正句 |
| 划分+基线 | `suite` | 见下表 | 训练集、三类评估集、规则基线上界 |
| 训练 | `train` 或训练页 | adapter / 合并后的模型 | 默认 `outputs/train` |
| 模型评估 | `infer --backend llamafactory --all` 再 `evaluate --all` | `infer/pred*.jsonl`、`reports/metrics.json`、`outputs/lf-predict` | 纠错分数；远程模型可用 `--backend http` |
| 调参 | `analyze --dir ./outputs/lf-predict --save` | `reports/analysis.md`、`reports/best/` | 不跑模型 |

`suite` 写出的评估相关文件：

| 文件 | 角色 |
| --- | --- |
| `outputs/splits/train.jsonl` | 拿去微调（**训练侧只需要这一份**） |
| `outputs/eval/eval_seen_pair.jsonl` | 词对见过、句子没见过 |
| `outputs/eval/eval_unseen_pair.jsonl` | 整组词对从未训练过 |
| `outputs/eval/eval_keep.jsonl` | 已经是规范句，不该改 |
| `outputs/eval/eval.jsonl` | seen + unseen 纠错评估全集 |
| `outputs/reports/split.json` | 各集规模、句子是否泄漏 |
| `outputs/reports/metrics.json` | 评估页打出的纠错分数（模型主路径；规则对照会覆盖同一文件） |

看分数时：

- **seen**：熟词对新句子还会不会改
- **unseen**：没见过的词对会不会泛化
- **keep**：规范句会不会被改坏
- **规则基线**：知道错词/正词时的上界，纠错集应接近 1；模型只能看句子，分数低于基线是正常的

### 评估之后：调参（不跑模型）

先在评估页跑完训练模型。预测目录默认是 `outputs/lf-predict`。

```bash
pnpm mtrain analyze --dir ./outputs/lf-predict --save --name stage1 --train-config ./outputs/llamafactory/train_sft.yaml
```

换超参再训、再评估，换 `--name` 再 `--save`。不要把 `--dir` 指到 `outputs/train`（checkpoint 里通常没有 generated_predictions.jsonl）。

`reports/compare.md` 会列出各轮 lr/epoch/rank 和 BLEU/ROUGE；综合分最高的训练配置复制到 `reports/best/train_sft.yaml`，下一轮建议在 `reports/best/suggested_next.yaml`。预测目录旁也会写一份 `analysis.md`。

CLI 不传 `--dir` 时默认读 `outputs/lf-predict`，与评估页一致。`train.outputDir` 只表示训练 checkpoint，给评估页加载模型用。

---

## 训练不在本文件夹时怎么接

数据工具和训练解耦：**训练机只消费训练集；评估集留在数据机上打分。**

### 1. 这边先把数据准备好

```bash
pnpm mtrain generate    # 等 [done]
pnpm mtrain suite
```

确认存在：`outputs/splits/train.jsonl`。

### 2. 把训练集交给训练环境

任选一种：

- 拷贝：`scp` / U 盘 / 共享盘，把 `train.jsonl` 放到训练机任意路径，例如 `/data/model-training/train.jsonl`
- 共享：NFS、SMB，训练机直接读仓库根 `outputs/splits/train.jsonl`
- 不必拷贝评估集、不必拷贝 Excel

### 3. 在训练环境的 LlamaFactory 里注册这份数据

在**训练机自己的** `dataset_info.json` 增加一条（路径改成你放 `train.jsonl` 的真实位置）：

```json
{
  "term_sft": {
    "file_name": "/data/model-training/train.jsonl",
    "formatting": "alpaca",
    "columns": {
      "prompt": "instruction",
      "query": "input",
      "response": "output"
    }
  }
}
```

Windows 用仓库根下 `outputs/splits/train.jsonl` 的绝对路径。  
`file_name` 若是相对路径，则相对于该 LlamaFactory 配置里的 `dataset_dir`。

训练 yaml 里对应：

```yaml
dataset_dir: 你的 dataset_info.json 所在目录
dataset: term_sft
template: qwen3   # 按基座改
output_dir: 训练机上的保存目录
```

本仓库的 `train/llamafactory/` 只是一份示例。训练在别的仓库时，**复制字段即可，不要依赖这个相对路径。**

### 4. 训完后把模型接到评估（本机主路径 / 远程可选）

本机：打开评估页，指向 `outputs/train`，主按钮走 LlamaFactory predict + 打分。不要跳过评估直接做调参。

训练在另一台机器时（可选旁路）：起 OpenAI 兼容接口，再用 HTTP 推理。评估集留在数据机上打分。

```bash
# 在训练环境
llamafactory-cli api 你的.yaml
# 或 vLLM / 其他服务，监听例如 http://训练机IP:8000
```

数据机改 `model-training.config.json`：

```js
infer: {
  backend: "http",
  http: {
    url: "http://训练机IP:8000/v1/chat/completions",
    model: "你的模型名",
    apiKeyEnv: "OPENAI_API_KEY",
  },
},
```

然后：

```bash
pnpm mtrain infer --backend http --all
pnpm mtrain evaluate --all
```

本机训练、本机 API 则 `url` 用 `http://127.0.0.1:8000/v1/chat/completions` 即可。

### 5. 不要做的事

- 不要把评估集混进训练（`eval/` 下的文件只用于打分）
- 不要用旧的 `history/train.json`（那是通用语法纠错，和固定表述不是同一任务）
- 不要用 LlamaFactory 的 `val_size` 当业务指标

---

## 和本仓库示例训练配置的关系

若训练就在本机、且用 `E:\llama\train\llamafactory`：

- `dataset_info.json` 里的相对路径指向 `outputs/sft/train.jsonl` 或 `outputs/splits/train.jsonl`
- 先跑完 `suite`，这个文件才会存在
- `train_sft.yaml` 里的 `model_name_or_path` / `output_dir` 仍要改成你自己的模型路径

若训练在别的位置：忽略这些相对路径，按上文第 3、4 步用绝对路径和 API 地址对接。
