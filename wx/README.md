# termcorr

固定表述纠错的**数据工具**：按「错误词 / 正确词」字典，从权威站点抽出含正确词的完整句，再把正确词换成错误词，得到可训练的句对。

本目录是 TypeScript 源码，用 Vite 打成 Node ESM。不含训练。微调见仓库根目录的 `train/`。

```bash
cd E:/llama/wx
pnpm install
pnpm build
pnpm link --global   # 之后任意目录可直接敲 termcorr
```

不要把配置、字典副本、生成结果写进本仓库。配置放你自己的工作目录，产物写到配置里的 `outDir`。

---

## 它做什么

给定词对：

```json
{"wrong": "习总书记", "correct": "习近平总书记", "error_type": "涉习"}
```

工具会：

1. 用**正确词**去人民网等站点检索正文；
2. 切出包含该正确词的完整句（作为 `output`）；
3. 把句中正确词替换成错误词（作为 `input`）。

得到的 SFT 样本形如：

| 字段 | 含义 |
| --- | --- |
| `instruction` | 任务说明 |
| `input` | 含错误表述的句子 |
| `output` | 规范表述的原句 |
| `wrong` / `correct` | 词对 |
| `error_type` | 错误类型 |
| `url` | 句子来源页 |

默认只写 **alpaca**。需要 ShareGPT 时配置 `formats: ["alpaca", "sharegpt"]` 或 `--format alpaca,sharegpt`，会多出 `sft/train_sharegpt.jsonl`：

```json
{
  "system": "请将句子中的不规范政治表述改正为规范表述，只输出改正后的句子。",
  "conversations": [
    { "from": "human", "value": "含错误表述的句子" },
    { "from": "gpt", "value": "规范句" }
  ]
}
```

配置 `formats: ["alpaca", "sharegpt"]` 可同时写出 ShareGPT。划分/评估始终以 alpaca 为准。

---

## 目录约定

| 位置 | 放什么 |
| --- | --- |
| `wx/`（本仓库） | CLI 源码、配置模板。不要在这里 `init`，也不要把 `outDir` 指到这里 |
| 你的工作目录 | `termcorr.config.js`、默认产物目录 `outputs/` |
| `outDir`（默认 `./outputs`） | `sft/`、`splits/`、`eval/`、`infer/`、`reports/` |
| `~/.termcorr/cache` | 各 HTTP 源的检索缓存（`cache/<源 name>/`） |
| `train/` | LlamaFactory 微调配置 |

`outDir` 默认布局：

```
outDir/
  sft/train.jsonl                 # generate：alpaca（默认）
  sft/train_sharegpt.jsonl        # 仅 formats 含 sharegpt 时
  splits/train.jsonl              # 训练用 alpaca
  splits/train_sharegpt.jsonl     # 仅 formats 含 sharegpt 时
  eval/eval.jsonl                 # 纠错评估全集（seen + unseen）
  eval/eval_seen_pair.jsonl       # 词对见过、句子没见过
  eval/eval_unseen_pair.jsonl     # 整组词对未进训练
  eval/eval_keep.jsonl            # 已是规范句，不应改动
  infer/pred.jsonl                # 评估全集预测
  infer/pred_seen_pair.jsonl
  infer/pred_unseen_pair.jsonl
  infer/pred_keep.jsonl
  reports/split.json              # 评估集建设报告
  reports/metrics.json            # 指标（含 by_split / by_error_type / by_freq_bucket）
  reports/scored.jsonl            # 逐条对错，便于看失败案例
```

---

## 快速开始

需要 Node.js 18+。命令名是 `termcorr`，和 Vite 一样写在 `package.json` 的 `bin` 里，**不必**再写 `node …/bin/termcorr.js`。

先在 CLI 目录构建一次：

```bash
cd E:/llama/wx
pnpm install
pnpm build
```

在**工作目录**初始化（第一次从 CLI 目录调，类似 `pnpm create vite`）：

```bash
cd 你的工作目录
pnpm --dir E:/llama/wx exec termcorr init
pnpm install
pnpm exec termcorr prepare --input "E:/llama/2024年10月29日18时29分09秒-错误表述数据 (1).xlsx" --force
node ./node_modules/termcorr/bin/termcorr.js generate
node ./node_modules/termcorr/bin/termcorr.js suite
```

Git bash 下不要直接敲 `termcorr`，也尽量不用 `pnpm exec termcorr`（经常没有输出）。用上面的 `node ./node_modules/termcorr/bin/termcorr.js`，或：

```bash
node E:/llama/wx/bin/termcorr.js generate
node E:/llama/wx/bin/termcorr.js suite
```

`init` 会写入 `package.json`，把本地 `wx` 链成依赖，所以 `pnpm generate` 实际跑的是 `termcorr generate`。`termcorr.config.js` 用 `defineConfig` 包一层，编辑器会限制字段名和 `sources` 的 `type` / `options`。

可选：`cd E:/llama/wx && pnpm link --global`，之后任意目录可直接敲 `termcorr`（需该目录已在 PATH 里，pnpm 全局 bin 一般是 `%LOCALAPPDATA%\pnpm`）。

也可用 `-c` 指定配置：

```bash
pnpm exec termcorr generate -c D:/work/termcorr.config.js
```

---

## 字典

每行一个词对。jsonl 示例：

```json
{"wrong": "十九大", "correct": "党的十九大", "error_type": "固定表述错误", "freq": 99043}
```

也认这些列名：`error` / `错误词` / `错词`，`ok` / `建议更正词` / `正词`，`type` / `错误类型`。

同词对会按 `freq` 合并去重。检索按**正确词**分组：同一个正确词只搜一次，再展开到它对应的所有错误词。

---

## 命令

全局选项：

| 选项 | 说明 |
| --- | --- |
| `-c, --config` | 配置文件。默认在当前目录找 `termcorr.config.js` / `.mjs` / `.cjs` / `.json` |
| `-h, --help` | 帮助 |

### `init`

把模板拷到当前目录的 `termcorr.config.js`，并写入把本 CLI 链成本地依赖的 `package.json`。默认 `outDir` 为 `./outputs`。

配置用 `defineConfig` 包一层，编辑器会按 `UserConfig` 提示字段、拦住拼错的键和 `sources[].type` 对应的 `options`：

```js
import { defineConfig } from "termcorr";

export default defineConfig({
  outDir: "./outputs",
  train: { config: "./train_sft.yaml", outputDir: "./test_stage1" },
  sources: [{ name: "people_search", type: "http", options: { url: "..." } }],
});
```

- 在 CLI 仓库内会拒绝，除非 `--force`
- 目标文件已存在也会拒绝，除非 `--force`

### `generate`

按字典检索并写出句对。已有输出文件会**断点续写**（相同 `wrong + correct + 正句` 会跳过）。

需要多条样本时，按搜索返回的列表**从上往下**取：每条结果最多一句（该篇里第一个合格句），不够再取下一条，不把第一篇里的句子抽干。

| 选项 | 说明 |
| --- | --- |
| `--dict` | 覆盖配置里的字典路径 |
| `--pairs-per-term` | 每个「错误词,正确词」最多保留几条句对 |
| `--limit-terms` | 只处理前 N 个正确词（试跑用） |
| `--source` | 只用某一个检索源（如 `people_search`） |
| `--output` | 覆盖默认的 `outDir/sft/train.jsonl` |
| `--format` | 默认 `alpaca`；`alpaca,sharegpt` 可同时写 ShareGPT |

远程 HTTP 真正发请求时按 `rate.requestsPerMinute` 限速（默认 5 次/分钟）。磁盘缓存命中不计入。

### `split`

把 `sft/train.jsonl` 划成训练集和三类评估集。若启用了 sharegpt，同时写出 `splits/train_sharegpt.jsonl`。

| 评估集 | 测什么 | 怎么抽 |
| --- | --- | --- |
| `eval_unseen_pair` | 没见过的词对能不能改 | 按错误类型分层，约 `unseenPairRatio`（默认 10%）的词对整组不进训练 |
| `eval_seen_pair` | 见过的词对、新句子 | 词对至少 `minPairSizeForSeenEval` 条（默认 **2**）时抽约 `seenPairEvalRatio`，并至少留 1 条训练 |
| `eval_keep` | 会不会把已经规范的句子改坏 | 从训练正句抽样，`input`=`output` |

另外会：

- 给每条样本写稳定 `id`（推理和评估按 id 对齐）
- 挂上 `freq` / `freq_bucket`（high / mid / low）
- 同一正句不会同时出现在训练集和纠错评估集（泄漏从训练侧剔除，并记入 `reports/split.json`）

`pairsPerTerm: 3` 时旧逻辑要求「至少 4 条才抽 seen」，会导致 seen 评估集几乎为空，所以默认改为至少 2 条。

| 选项 | 说明 |
| --- | --- |
| `--input` | 覆盖默认 SFT 文件 |
| `--train-out` / `--eval-out` | 覆盖训练集 / 评估全集路径 |

### `suite`

`split` + 对全部评估切片推理 + `evaluate --all`。默认规则基线，不跑 generate。

```bash
node E:/llama/wx/bin/termcorr.js suite
node E:/llama/wx/bin/termcorr.js suite --backend http
```

### `infer`

对评估集做推理，写出 `pred.jsonl`（每行 `{ "id", "pred" }`）。

| `--backend` | 行为 |
| --- | --- |
| `rule` | 把 `input` 里的 `wrong` 替换成 `correct`（规则基线） |
| `http` | 调 OpenAI 兼容的 `/v1/chat/completions`（system=instruction，user=input） |
| `file` | 只把待推理样本拷到输出路径，留给外部脚本 |

| 选项 | 说明 |
| --- | --- |
| `--all` | 对 eval / seen / unseen / keep 各写一份 pred |
| `--input` / `--output` | 覆盖评估集 / 预测文件 |
| `--url` / `--model` | 覆盖 http 后端的地址和模型名 |

### `evaluate`

对比 gold 与 pred，写出 `reports/metrics.json` 和逐条 `reports/scored.jsonl`。

| 指标 | 含义 |
| --- | --- |
| `exact_match` | 预测与 gold 全文一致（忽略空白） |
| `term_fix_rate` | 正确词已出现，且错误词不再作为独立片段残留（正确词包含错误词时仍有效） |
| `only_term_change` | 预测恰好等于「只改了这个词」的结果 |
| `over_edit_rate` | 不是 exact match，且改动超出了该词替换 |
| `copy_input_rate` | 原样复述了错句 |
| `empty_rate` | 空输出 |

报告里还有 `by_split`、`by_error_type`、`by_freq_bucket`。`--all` 会额外给出 `slices`（四个评估文件各自的分数）。

`--baseline` 会先用规则替换写出 pred（默认全部切片），再评估。这是对照上界：规则知道 wrong/correct 时，纠错集应接近 1.0；keep 集也应保持原句。

### `analyze`

LlamaFactory 验证或 `predict` 跑完后，分析其输出目录里的指标 JSON / 预测 jsonl，给出**训练超参**建议（学习率、epoch、LoRA 等）。不调推理接口。

```bash
node E:/llama/wx/bin/termcorr.js analyze --dir E:/llama/test_stage1 --save --name test_stage1 --train-config ../train/llamafactory/train_sft.yaml
node E:/llama/wx/bin/termcorr.js analyze --dir E:/llama/test_stage2 --save --name test_stage2 --train-config ../train/llamafactory/train_sft.yaml
node E:/llama/wx/bin/termcorr.js analyze --compare
```

| 文件 | 作用 |
| --- | --- |
| 验证目录下的 `analysis.md` | 本轮验证解读 + 下一轮训练参数建议（方便就地看） |
| `outputs/reports/analysis.md` | 同上，写在工作区 |
| `outputs/reports/runs/<name>/train_sft.yaml` | 本轮实际训练配置 |
| `outputs/reports/runs/<name>/suggested_next.yaml` | 建议的下一轮 yaml |
| `outputs/reports/compare.md` | 多轮模型对比 |
| `outputs/reports/best/train_sft.yaml` | 综合分最高的那一轮训练配置 |

工作区可在 `termcorr.config.js` 里设 `train.config` 和 `train.outputDir`。

### `sources`

列出内置源类型：`http`、`local_jsonl`。具体接口在配置的 `sources` 里写，不写死在代码里。

---

## 检索源（配置多接口）

`sources` 是数组，可同时写多条。`generate` 按顺序尝试，某个源抽出句子后即换下一个正确词。

内置只有两种 **type**：

| type | 作用 |
| --- | --- |
| `http` | 任意检索 HTTP 接口。URL、方法、请求头、JSON 体、如何从响应取正文，全部写在 `options` |
| `local_jsonl` | 本地 jsonl 语料（字段 `text` 或 `content`） |

人民网只是模板里的一条 `type: "http"` 示例，不是代码里的专用类。再加站点：复制一条，改 `name` / `url` / `body` / `fields`。

`url`、`headers`、`body`、`query` 里的 `{{keyword}}` 会换成当前正确词。

HTTP `options` 要点：

| 字段 | 说明 |
| --- | --- |
| `url` / `method` | 绝对地址，GET 或 POST |
| `headers` / `body` / `query` | 可含 `{{keyword}}` |
| `recordsPath` | 记录数组的 JSON 路径，如 `data.records` |
| `codePath` / `okCodes` | 业务状态码（不是 HTTP 状态） |
| `fields.html` 等 | 从一条 record 取正文/标题/链接/id，数组表示按顺序尝试 |
| `timeoutSec` | 超时秒数 |
| `requestsPerMinute` | 仅覆盖这一条源的频率 |

```js
sources: [
  { name: "people_search", type: "http", enabled: true, options: { url: "...", method: "POST", body: { key: "{{keyword}}" }, recordsPath: "data.records", fields: { html: ["contentOriginal", "content"] } } },
  { name: "another", type: "http", enabled: true, options: { url: "https://example.com/search", method: "GET", query: { q: "{{keyword}}" }, recordsPath: "data.list" } },
  { name: "local_corpus", type: "local_jsonl", enabled: false, options: { path: "./corpus.jsonl", limit: 20 } },
]
```

完整人民网示例见 `templates/termcorr.config.js`。

---

## 请求频率

默认 **每分钟 5 次**（间隔约 12 秒），并加 `jitterSec`（默认 2 秒）随机等待，降低被对方判成异常流量的概率。

```js
rate: { requestsPerMinute: 5, jitterSec: 2 }
```

改频率只动这个数字。缓存命中不发请求、不占用配额。多条 HTTP 源默认共用这一上限；某条源可在 `options.requestsPerMinute` 单独设。

---

## 训练

`generate` 结束后在工作目录执行 `suite`（划分评估集 + 规则基线）。`train/llamafactory/dataset_info.json` 已指向 `termcorr-work/outputs/splits/train.jsonl`。微调步骤见 `train/README.md`。

---

## 开发

源码在 `src/`，类型在 `src/types.ts`。改完后必须重新打包，CLI 跑的是 `dist/`：

```bash
cd E:/llama/wx
pnpm build      # Vite 打 ESM + tsc 生成 .d.ts
pnpm typecheck  # 只做类型检查
pnpm link --global   # 刷新 PATH 上的 termcorr 命令
```
