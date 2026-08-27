# 固定表述纠错：数据 → 训练 → 评估

本仓库分成两块，可以不在同一台机器、同一个文件夹里：

| 块 | 目录 | 做什么 |
| --- | --- | --- |
| 数据与评估 | `wx/` + 工作区 `termcorr-work/` | 洗字典、生成句对、划分评估集、打分 |
| 训练 | 任意 LlamaFactory 环境 | 只吃一份 `train.jsonl`，产出 LoRA |

训练目录不必是 `E:\llama\train`。只要能读到划分后的训练集、训完能提供 OpenAI 兼容接口，就可以接回这边评估。

---

## 链路

```
Excel 监测表
    │  prepare
    ▼
词对字典          termcorr-work/data/term_pairs.jsonl
    │  generate（用正确词检索权威站点，再改成错句）
    ▼
全部句对          termcorr-work/outputs/sft/train.jsonl
    │  suite = split + 规则基线 + 评估
    ├──────────────────┬──────────────────┐
    ▼                  ▼                  ▼
训练集              评估集              规则基线分数
splits/train.jsonl  eval/*.jsonl      reports/metrics.json
    │                  │
    │  （拷到训练机器）   │  训完后 infer --backend http --all
    ▼                  ▼
LoRA / 模型服务      infer/pred*.jsonl
                       │  evaluate --all
                       ▼
                    reports/metrics.json（模型分数，和基线对比）
```

LlamaFactory 配置里的 `val_size` 只是训练过程损失，**正式指标一律用 `termcorr evaluate`**。

---

## 各步产物

工作区默认是 `E:\llama\termcorr-work`，命令都在该目录执行：

```bash
node E:/llama/wx/bin/termcorr.js <命令>
```

| 步骤 | 命令 | 产物 | 作用 |
| --- | --- | --- | --- |
| 洗字典 | `prepare --input 那个.xlsx --force` | `data/term_pairs.jsonl` | 错误词/正确词，一对多会写成多条 |
| 生成句对 | `generate` | `outputs/sft/train.jsonl` | `input`=错句，`output`=正句 |
| 划分+基线 | `suite` | 见下表 | 训练集、三类评估集、规则基线上界 |
| 训练 | 在训练环境跑 LlamaFactory | adapter / 合并后的模型 | 不在本数据目录里也行 |
| 模型评估 | `infer --backend http --all` 再 `evaluate --all` | `infer/pred*.jsonl`、`reports/metrics.json` | 和基线对比 |

`suite` 写出的评估相关文件：

| 文件 | 角色 |
| --- | --- |
| `outputs/splits/train.jsonl` | 拿去微调（**训练侧只需要这一份**） |
| `outputs/eval/eval_seen_pair.jsonl` | 词对见过、句子没见过 |
| `outputs/eval/eval_unseen_pair.jsonl` | 整组词对从未训练过 |
| `outputs/eval/eval_keep.jsonl` | 已经是规范句，不该改 |
| `outputs/eval/eval.jsonl` | seen + unseen 纠错评估全集 |
| `outputs/reports/split.json` | 各集规模、句子是否泄漏 |
| `outputs/reports/metrics.json` | 先是规则基线；模型评估后再覆盖或另存 |

看分数时：

- **seen**：熟词对新句子还会不会改
- **unseen**：没见过的词对会不会泛化
- **keep**：规范句会不会被改坏
- **规则基线**：知道错词/正词时的上界，纠错集应接近 1；模型只能看句子，分数低于基线是正常的

---

## 训练不在本文件夹时怎么接

数据工具和训练解耦：**训练机只消费训练集；评估集留在数据机上打分。**

### 1. 这边先把数据准备好

```bash
cd E:/llama/termcorr-work
node E:/llama/wx/bin/termcorr.js generate    # 等 [done]
node E:/llama/wx/bin/termcorr.js suite
```

确认存在：`outputs/splits/train.jsonl`。

### 2. 把训练集交给训练环境

任选一种：

- 拷贝：`scp` / U 盘 / 共享盘，把 `train.jsonl` 放到训练机任意路径，例如 `/data/termcorr/train.jsonl`
- 共享：NFS、SMB，训练机直接读 `E:\llama\termcorr-work\outputs\splits\train.jsonl`（WSL 下是 `/mnt/e/llama/termcorr-work/outputs/splits/train.jsonl`）
- 不必拷贝 `wx/`、不必拷贝评估集、不必拷贝 Excel

### 3. 在训练环境的 LlamaFactory 里注册这份数据

在**训练机自己的** `dataset_info.json` 增加一条（路径改成你放 `train.jsonl` 的真实位置）：

```json
{
  "term_sft": {
    "file_name": "/data/termcorr/train.jsonl",
    "formatting": "alpaca",
    "columns": {
      "prompt": "instruction",
      "query": "input",
      "response": "output"
    }
  }
}
```

Windows 用 `E:/llama/termcorr-work/outputs/splits/train.jsonl`，WSL 用 `/mnt/e/...`。  
`file_name` 若是相对路径，则相对于该 LlamaFactory 配置里的 `dataset_dir`。

训练 yaml 里对应：

```yaml
dataset_dir: 你的 dataset_info.json 所在目录
dataset: term_sft
template: qwen   # 按基座改
output_dir: 训练机上的保存目录
```

本仓库的 `train/llamafactory/` 只是一份示例。训练在别的仓库时，**复制字段即可，不要依赖这个相对路径。**

### 4. 训完后把模型接到评估

评估仍在数据机（`termcorr-work`）跑，因为评估集在这边。训练机需要提供 OpenAI 兼容的 `/v1/chat/completions`：

```bash
# 在训练环境
llamafactory-cli api 你的.yaml
# 或 vLLM / 其他服务，监听例如 http://训练机IP:8000
```

数据机改 `termcorr-work/termcorr.config.js`：

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
cd E:/llama/termcorr-work
node E:/llama/wx/bin/termcorr.js infer --backend http --all
node E:/llama/wx/bin/termcorr.js evaluate --all
```

本机训练、本机 API 则 `url` 用 `http://127.0.0.1:8000/v1/chat/completions` 即可。

### 5. 不要做的事

- 不要把评估集混进训练（`eval/` 下的文件只用于打分）
- 不要用旧的 `history/train.json`（那是通用语法纠错，和固定表述不是同一任务）
- 不要用 LlamaFactory 的 `val_size` 当业务指标

---

## 和本仓库示例训练配置的关系

若训练就在本机、且用 `E:\llama\train\llamafactory`：

- `dataset_info.json` 里的相对路径指向 `termcorr-work/outputs/splits/train.jsonl`
- 先跑完 `suite`，这个文件才会存在
- `train_sft.yaml` 里的 `model_name_or_path` / `output_dir` 仍要改成你自己的模型路径

若训练在别的位置：忽略这些相对路径，按上文第 3、4 步用绝对路径和 API 地址对接。
