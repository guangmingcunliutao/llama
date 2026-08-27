/**
 * 命令行入口：解析子命令，加载工作区配置，再交给 generate / split / infer / evaluate。
 * 配置必须在 CLI 仓库外；见 loadUserConfig。
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { isInsideDir, loadUserConfig, packageRoot } from "./config.js";
import { evaluate, evaluateAll, ruleBaseline, ruleBaselineAll } from "./evaluate.js";
import { generate } from "./generate.js";
import { infer } from "./infer.js";
import { prepareDict } from "./prepare.js";
import { availableSourceTypes } from "./sources/registry.js";
import { splitDataset } from "./split.js";
import { isRecord } from "./util.js";

const HELP: Record<string, string> = {
  _: `termcorr — 固定表述纠错数据工具（生成句对 / 划分 / 评估 / 推理，不含训练）

配置放在你的工作目录，不要放进本 CLI 仓库。产物写到配置的 outDir。
源码为 TypeScript，发布前在 wx 目录执行 pnpm build。产物默认写到工作目录下的 outputs/。

用法:
  termcorr <command> [options]
  termcorr <command> --help

命令:
  init       在当前目录生成 termcorr.config.js
  prepare    从监测 Excel 洗出错误词/正确词字典
  generate   用正确词检索权威站点，生成错误句 / 正确句
  split      划分训练集与评估集（seen / unseen / keep）
  infer      推理（rule / http / file）
  evaluate   对比预测与 gold，写出指标
  suite      split + 基线推理 + 评估（不跑 generate）
  sources    列出内置源类型（http / local_jsonl）

全局选项:
  -c, --config <file>   配置文件（默认扫描当前目录的 termcorr.config.*）
  -h, --help            帮助

示例:
  cd 工作目录
  termcorr init && pnpm install
  termcorr prepare --input 错误表述数据.xlsx
  termcorr generate --limit-terms 1 --pairs-per-term 1
  termcorr suite
  termcorr infer --backend http --all
  termcorr evaluate --all
`,
  init: `init — 在当前目录生成 termcorr.config.js 和 package.json

package.json 会把本 CLI 链成本地依赖（file:…），pnpm install 之后可直接敲 termcorr，不必写 node。
默认 outDir 为 ./outputs。请再改 dict。

选项:
  --force    允许覆盖已有配置；也允许在 CLI 仓库内生成（不推荐）
`,
  prepare: `prepare — 从监测 Excel 洗出 term_pairs.jsonl

按「错误词 / 建议更正词」拆格、去重、合并频次。正词短于 3 字、错词正词相同的行会丢掉。

选项:
  --input <file>           Excel 路径
  --output <file>          默认 ./data/term_pairs.jsonl
  --min-correct-len <n>    正词最短长度，默认 3
  --force                  覆盖已有输出
`,
  generate: `generate — 按字典检索并写出 SFT 句对

用正确词检索正文，按搜索结果从上往下每条取一句作为 output，再把正确词换成错误词作为 input。
已有输出文件会断点续写。远程 HTTP 默认最多 5 次/分钟（缓存命中不计入），见 rate.requestsPerMinute。

选项:
  --dict <file>           覆盖配置里的字典
  --pairs-per-term <n>    每个词对最多保留几条
  --limit-terms <n>       只处理前 N 个正确词（试跑）
  --source <name>         只用配置里某一个源的 name
  --output <file>         覆盖默认 outDir/sft/train.jsonl
  --format <list>         默认 alpaca；需要 ShareGPT 时用 alpaca,sharegpt
`,
  split: `split — 划分 train / eval_seen_pair / eval_unseen_pair / eval_keep

eval_unseen_pair：整组词对不进训练，测能否改没见过的词对。
eval_seen_pair：词对见过、句子没见过；词对至少 2 条才抽（可配 split.minPairSizeForSeenEval）。
eval_keep：已是规范句，不应改动，测过度编辑。
同一正句不会同时出现在训练和纠错评估集。样本带稳定 id、freq_bucket。

选项:
  --input <file>       覆盖默认 sft/train.jsonl
  --train-out <file>   覆盖 splits/train.jsonl
  --eval-out <file>    覆盖 eval/eval.jsonl
`,
  infer: `infer — 对评估集推理，写出 {id, pred}

backend:
  rule   把 input 里的 wrong 换成 correct（规则基线）
  http   调 OpenAI 兼容 chat/completions（system=instruction，user=input）
  file   只导出待推理样本

选项:
  --backend <name>
  --all             对 eval / seen / unseen / keep 各推理一份
  --input <file>    覆盖评估集
  --output <file>   覆盖 infer/pred.jsonl
  --url <url>       覆盖 infer.http.url
  --model <name>    覆盖 infer.http.model
`,
  evaluate: `evaluate — 对比 gold 与 pred

指标：exact_match、term_fix_rate、only_term_change、over_edit_rate、copy_input_rate、empty_rate。
同时按 split / error_type / freq_bucket 分组。pred 按 id 对齐。

选项:
  --gold <file>     覆盖 eval/eval.jsonl
  --pred <file>     覆盖 infer/pred.jsonl
  --output <file>   覆盖 reports/metrics.json
  --all             评估全部切片（需已有对应 pred）
  --baseline        先用规则替换写出 pred，再评估
`,
  suite: `suite — 划分评估集 + 推理 + 评估（不跑 generate）

默认用规则基线。模型评估时加 --backend http。

选项:
  --backend <name>  rule（默认）或 http
  --url / --model   覆盖 http 推理
`,
  sources: `sources — 列出内置源类型

http         通用 HTTP 检索，URL / 方法 / 取字段全在配置里，可写多条
local_jsonl  本地 jsonl 语料
`,
};

function help(command?: string): string {
  if (command && HELP[command]) return HELP[command].trimEnd();
  return HELP._.trimEnd();
}

function fileDependency(fromDir: string, pkgRoot: string): string {
  const rel = path.relative(fromDir, pkgRoot).replaceAll("\\", "/");
  if (!rel || rel === "") return "file:.";
  return `file:${rel.startsWith(".") ? rel : `./${rel}`}`;
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === "string") out[key] = nested;
  }
  return out;
}

/**
 * 工作区 package.json：把本地 CLI 链成依赖，之后可直接敲 termcorr（和 vite 一样走 node_modules/.bin）。
 */
function initWorkPackage(cwd: string): string {
  const dest = path.join(cwd, "package.json");
  const existing: unknown = fs.existsSync(dest) ? JSON.parse(fs.readFileSync(dest, "utf8")) : {};
  const prev = isRecord(existing) ? existing : {};
  const scripts = stringMap(prev.scripts);
  const devDependencies = stringMap(prev.devDependencies);
  const pkg = {
    ...prev,
    name: typeof prev.name === "string" ? prev.name : path.basename(cwd),
    private: true,
    type: typeof prev.type === "string" ? prev.type : "module",
    scripts: {
      generate: "node ./node_modules/termcorr/bin/termcorr.js generate",
      prepare: "node ./node_modules/termcorr/bin/termcorr.js prepare",
      split: "node ./node_modules/termcorr/bin/termcorr.js split",
      infer: "node ./node_modules/termcorr/bin/termcorr.js infer",
      evaluate: "node ./node_modules/termcorr/bin/termcorr.js evaluate",
      suite: "node ./node_modules/termcorr/bin/termcorr.js suite",
      ...scripts,
    },
    devDependencies: {
      ...devDependencies,
      termcorr: fileDependency(cwd, packageRoot()),
    },
  };
  fs.writeFileSync(dest, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return dest;
}

function initConfig({ force = false, cwd = process.cwd() } = {}): string {
  const dest = path.join(cwd, "termcorr.config.js");
  if (isInsideDir(packageRoot(), dest) && !force) {
    throw new Error("请勿在 CLI 仓库内生成配置。换到你的工作目录再执行 init，或加 --force。");
  }
  if (fs.existsSync(dest) && !force) {
    throw new Error(`已存在 ${dest}，如需覆盖请加 --force`);
  }
  const template = fs.readFileSync(path.join(packageRoot(), "templates", "termcorr.config.js"), "utf8");
  fs.writeFileSync(dest, template, "utf8");
  const pkgFile = initWorkPackage(cwd);
  console.log(`[init] 已写入 ${dest}`);
  console.log(`[init] 已写入 ${pkgFile}`);
  console.log(`[init] 请执行 pnpm install，之后可直接运行 termcorr generate`);
  return dest;
}

export async function main(argv: string[]): Promise<number> {
  const command = argv[0];
  if (!command || command === "-h" || command === "--help" || command === "help") {
    console.log(help(argv[1]));
    return 0;
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      config: { type: "string", short: "c" },
      dict: { type: "string" },
      "pairs-per-term": { type: "string" },
      "limit-terms": { type: "string" },
      "min-correct-len": { type: "string" },
      source: { type: "string" },
      output: { type: "string" },
      format: { type: "string" },
      input: { type: "string" },
      "train-out": { type: "string" },
      "eval-out": { type: "string" },
      gold: { type: "string" },
      pred: { type: "string" },
      backend: { type: "string" },
      url: { type: "string" },
      model: { type: "string" },
      baseline: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });
  if (values.help) {
    console.log(help(command));
    return 0;
  }

  if (command === "init") {
    initConfig({ force: values.force });
    return 0;
  }

  if (command === "prepare") {
    prepareDict({
      input: values.input,
      output: values.output,
      minCorrectLen: values["min-correct-len"],
      force: values.force,
    });
    return 0;
  }

  if (command === "sources") {
    console.log(availableSourceTypes().join("\n"));
    return 0;
  }

  const cfg = await loadUserConfig({ command, config: values.config });

  if (command === "generate") {
    await generate(cfg, {
      dict: values.dict,
      pairsPerTerm: values["pairs-per-term"],
      limitTerms: values["limit-terms"],
      source: values.source,
      output: values.output,
      format: values.format,
    });
    return 0;
  }

  if (command === "split") {
    splitDataset(cfg, {
      input: values.input,
      trainOut: values["train-out"],
      evalOut: values["eval-out"],
    });
    return 0;
  }

  if (command === "evaluate") {
    if (values.baseline && (values.all || !values.gold)) {
      ruleBaselineAll(cfg);
    } else if (values.baseline) {
      ruleBaseline(values.gold || cfg.paths.eval, values.pred || cfg.paths.pred);
    }
    evaluate(cfg, {
      gold: values.gold,
      pred: values.pred,
      output: values.output,
      all: values.all || (values.baseline && !values.gold),
    });
    return 0;
  }

  if (command === "infer") {
    await infer(cfg, {
      input: values.input,
      output: values.output,
      backend: values.backend,
      url: values.url,
      model: values.model,
      all: values.all,
    });
    return 0;
  }

  if (command === "suite") {
    splitDataset(cfg, {
      input: values.input,
      trainOut: values["train-out"],
      evalOut: values["eval-out"],
    });
    const backend = values.backend || "rule";
    if (backend === "rule") {
      ruleBaselineAll(cfg);
    } else {
      await infer(cfg, {
        backend,
        url: values.url,
        model: values.model,
        all: true,
      });
    }
    evaluateAll(cfg, { output: values.output });
    return 0;
  }

  console.error(`未知命令: ${command}\n`);
  console.log(help());
  return 1;
}

void main(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (err: unknown) => {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    console.error(message);
    process.exit(1);
  },
);
