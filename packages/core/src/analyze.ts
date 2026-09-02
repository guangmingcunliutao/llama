/**
 * 分析 LlamaFactory 验证/预测输出：写成 Markdown、给出训练超参建议、
 * 对比历史 run、保存最优训练配置。
 *
 * 读的是 output_dir 里的 predict_results.json / all_results.json /
 * generated_predictions.jsonl / trainer_state.json，不调推理接口。
 *
 * 综合分（越高越好，BLEU/ROUGE 先除以 100）：
 *   0.35 * ROUGE-L + 0.25 * BLEU-4 + 0.25 * exact_match + 0.15 * (1 - copy_input)
 * 若没有预测产物，则退回 -eval_loss。
 */
import fs from "node:fs";
import path from "node:path";
import { applyGoldPredMetrics, loadLfMetrics, rankingScore, type LfSnapshot } from "./lfMetrics.js";
import { asNumber, parseTrainYaml, patchTrainYaml, type TrainKnobs } from "./trainYaml.js";
import type { AnalyzeFlags, ConfigSnapshot, Leaderboard, ResolvedConfig, RunRecord, Suggestion } from "./types.js";

export const RANKING_METRIC =
  "0.35*ROUGE-L + 0.25*BLEU-4 + 0.25*exact_match + 0.15*(1-copy_input)";

function pct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function num(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

export function loadTrainFile(
  cfg: ResolvedConfig,
  flags: AnalyzeFlags,
): { path: string | null; knobs: TrainKnobs; yaml: string | null } {
  const file = flags.trainConfig
    ? path.isAbsolute(flags.trainConfig)
      ? flags.trainConfig
      : path.resolve(cfg.root, flags.trainConfig)
    : cfg.trainConfig;
  if (!file || !fs.existsSync(file)) return { path: file, knobs: {}, yaml: null };
  const yaml = fs.readFileSync(file, "utf8");
  return { path: file, knobs: parseTrainYaml(yaml), yaml };
}

function resolveOutputDir(cfg: ResolvedConfig, flags: AnalyzeFlags): string | null {
  if (flags.dir) {
    return path.isAbsolute(flags.dir) ? flags.dir : path.resolve(cfg.cwd, flags.dir);
  }
  /** 默认读评估页 LlamaFactory predict 目录，不要落到 train.outputDir（checkpoint）。 */
  return cfg.paths.lfPredict;
}

export function snapshotConfig(
  flags: AnalyzeFlags,
  train: { path: string | null; knobs: TrainKnobs },
  outputDir: string,
): ConfigSnapshot {
  return {
    kind: "model",
    train: { ...train.knobs },
    trainConfigPath: train.path,
    outputDir,
    note: flags.note || undefined,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function pickRank(current: number, prefer: "up" | "down"): number {
  const ladder = [8, 16, 32, 64];
  if (prefer === "up") return ladder.find((x) => x > current) ?? 64;
  const lower = [...ladder].reverse().find((x) => x < current);
  return lower ?? 8;
}

export function collectSuggestions(
  snap: LfSnapshot,
  config: ConfigSnapshot,
): { suggestions: Suggestion[]; patch: Record<string, string | number> } {
  const out: Suggestion[] = [];
  const patch: Record<string, string | number> = {};
  const train = config.train;
  const lr = asNumber(train, "learning_rate", 1e-4);
  const epochs = asNumber(train, "num_train_epochs", 3);
  const rank = asNumber(train, "lora_rank", 16);
  const dropout = asNumber(train, "lora_dropout", 0.05);
  const cutoff = asNumber(train, "cutoff_len", 512);
  const warmup = asNumber(train, "warmup_ratio", 0.05);
  const copy = snap.copy_input_rate ?? 0;
  const repeat = snap.repeat_rate ?? 0;
  const empty = snap.empty_rate ?? 0;
  const exact = snap.exact_match ?? 0;
  const bleu = snap.bleu4 ?? 0;
  const rouge = snap.rougel ?? snap.rouge1 ?? 0;
  const lengthRatio = snap.length_ratio ?? 1;

  const set = (key: string, value: string | number, why: Suggestion) => {
    patch[key] = value;
    why.knobs[key] = value;
  };

  let blockMoreEpochs = false;

  if (repeat >= 0.05) {
    blockMoreEpochs = true;
    const nextLr = Math.max(lr * 0.5, 2e-5);
    const nextEpochs = clamp(epochs - 0.5, 1, 6);
    const item: Suggestion = {
      level: "high",
      title: "重复生成偏多",
      detail: `repeat_rate=${pct(repeat)}。模型把同一句写了两遍，常见于学习率偏高或训过头。先把 learning_rate 降一档，epoch 不要再加；推理侧可加 repetition_penalty（约 1.1），并检查 max_new_tokens 是否过大。`,
      knobs: {},
    };
    set("learning_rate", nextLr, item);
    set("num_train_epochs", nextEpochs, item);
    set("lora_dropout", Math.min(0.15, Math.max(dropout, 0.1)), item);
    out.push(item);
  }

  if (lengthRatio >= 1.15 && repeat < 0.05) {
    const nextLr = Math.max(lr * 0.7, 2e-5);
    const item: Suggestion = {
      level: "mid",
      title: "预测句比金标更长",
      detail: `平均预测/金标字数比=${num(lengthRatio, 2)}。模型在补写而不是最小编辑。略降学习率，推理保持 temperature=0。`,
      knobs: {},
    };
    if (!("learning_rate" in patch)) set("learning_rate", nextLr, item);
    out.push(item);
  }

  if (copy >= 0.25) {
    const item: Suggestion = {
      level: "high",
      title: "欠拟合：大量原样复述输入",
      detail: `copy_input_rate=${pct(copy)}。模型还没学会该改的地方。确认训练数据与验证任务一致（同一 instruction / chat template）。`,
      knobs: {},
    };
    if (blockMoreEpochs) {
      item.detail += " 同时出现重复生成，不要靠加 epoch 硬扛，先降学习率再训一轮。";
    } else {
      set("num_train_epochs", clamp(Math.ceil(epochs) + 1, 2, 6), item);
      if (lr < 5e-5) set("learning_rate", 1e-4, item);
      if (rank < 16) set("lora_rank", pickRank(rank, "up"), item);
    }
    out.push(item);
  } else if (copy >= 0.12) {
    const item: Suggestion = {
      level: "mid",
      title: "仍有一部分原样复述",
      detail: `copy_input_rate=${pct(copy)}。说明还有该改没改的句子。${blockMoreEpochs ? "当前优先处理重复生成，不要加 epoch。" : "可维持当前 epoch，优先保证数据和模板对齐，而不是猛加训练步数。"}`,
      knobs: {},
    };
    out.push(item);
  }

  if (empty >= 0.03) {
    const item: Suggestion = {
      level: "high",
      title: "空输出偏多",
      detail: `empty_rate=${pct(empty)}。先查预测配置的 max_new_tokens、模板是否截断；训练侧可把 cutoff_len 加到 1024。`,
      knobs: {},
    };
    if (cutoff < 1024) set("cutoff_len", 1024, item);
    out.push(item);
  }

  if (rouge >= 70 && exact < 0.15) {
    out.push({
      level: "mid",
      title: "语义接近，但不要为刷 exact_match 加训练",
      detail: `ROUGE-L=${num(rouge)}，exact_match=${pct(exact)}。纠错任务里金标往往不是唯一改法，exact 低、重叠高是正常的。继续加 epoch 更容易重复生成和改写过头。`,
      knobs: {},
    });
  }

  if (bleu > 0 && bleu < 40 && copy < 0.25) {
    const item: Suggestion = {
      level: "mid",
      title: "BLEU 偏低，生成与金标差距大",
      detail: `BLEU-4=${num(bleu)}。若不是任务本身允许多种改法，可把 lora_rank 升一档，或确认验证集与训练数据同分布。`,
      knobs: {},
    };
    if (!("lora_rank" in patch) && rank < 32) {
      set("lora_rank", pickRank(rank, "up"), item);
    }
    out.push(item);
  }

  if (warmup < 0.03) {
    const item: Suggestion = {
      level: "low",
      title: "warmup 过短",
      detail: "很小的 warmup 容易前几步把 LoRA 冲歪。提到 0.05。",
      knobs: {},
    };
    set("warmup_ratio", 0.05, item);
    out.push(item);
  }

  if (!out.some((s) => s.level === "high") && bleu >= 55 && copy < 0.2 && repeat < 0.05) {
    out.push({
      level: "low",
      title: "可以维持当前训练参数",
      detail: "BLEU/ROUGE 已到可用区间，没有明显的复述或空输出。不要为刷 exact_match 继续加 epoch。",
      knobs: {
        learning_rate: lr,
        num_train_epochs: epochs,
        lora_rank: rank,
      },
    });
  }

  if (!config.trainConfigPath) {
    out.unshift({
      level: "mid",
      title: "没有读到训练 yaml",
      detail: "用 --train-config 指向本轮实际使用的 LlamaFactory yaml，下一轮建议才能写成可直接训练的文件。",
      knobs: {},
    });
  }

  return { suggestions: out, patch };
}

function mdTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}`;
}

function verdict(snap: LfSnapshot): string {
  const copy = snap.copy_input_rate ?? 0;
  const repeat = snap.repeat_rate ?? 0;
  const rouge = snap.rougel ?? 0;
  const exact = snap.exact_match ?? 0;
  const parts: string[] = [];
  if (!snap.n_pred) {
    return "没有逐条预测，无法统计整句一致 / 复述输入 / 重复生成。lf-predict 里若只有 trainer_log.jsonl（进度日志），那三项会显示成空，并不是模型真的全是 0%。请先完成评估；有 outputs/infer/pred.jsonl 时会自动用来算这三项。";
  }
  parts.push(`共 ${snap.n_pred} 条预测`);
  if (snap.bleu4 != null) parts.push(`BLEU-4 ${num(snap.bleu4)}，ROUGE-L ${num(snap.rougel)}`);
  parts.push(`整句完全一致 ${pct(exact)}，原样复述输入 ${pct(copy)}，重复生成 ${pct(repeat)}`);
  if (rouge >= 70 && exact < 0.2) {
    parts.push("重叠指标尚可，但 exact_match 低，说明模型大致改对了方向，遣词与金标仍常不一致");
  }
  if (copy >= 0.12) parts.push("有一部分句子该改没改");
  if (repeat >= 0.05) parts.push("重复生成是当前更需要处理的问题，不宜再加 epoch");
  if (snap.eval_loss != null) parts.push(`eval_loss=${num(snap.eval_loss, 4)}`);
  return parts.join("。") + (parts.length ? "。" : "");
}

export function renderAnalysisMarkdown(run: RunRecord): string {
  const s = run.snapshot;
  const lines: string[] = [];
  lines.push(`# 模型验证分析：${run.name}`);
  lines.push("");
  lines.push(`- 时间：${run.saved_at}`);
  lines.push(`- 验证目录：\`${run.config.outputDir}\``);
  lines.push(`- 读到的文件：${s.files.join("、") || "—"}`);
  lines.push(`- 综合分：**${run.score.toFixed(4)}**（${RANKING_METRIC}）`);
  if (run.config.note) lines.push(`- 备注：${run.config.note}`);
  if (run.config.trainConfigPath) lines.push(`- 训练配置：\`${run.config.trainConfigPath}\``);
  lines.push("");
  lines.push("## 验证结论");
  lines.push("");
  lines.push(verdict(s));
  lines.push("");

  const trainRows = [
    ["learning_rate", String(run.config.train.learning_rate ?? "—")],
    ["num_train_epochs", String(run.config.train.num_train_epochs ?? "—")],
    ["lora_rank", String(run.config.train.lora_rank ?? "—")],
    ["lora_alpha", String(run.config.train.lora_alpha ?? "—")],
    ["lora_dropout", String(run.config.train.lora_dropout ?? "—")],
    ["per_device_train_batch_size", String(run.config.train.per_device_train_batch_size ?? "—")],
    ["gradient_accumulation_steps", String(run.config.train.gradient_accumulation_steps ?? "—")],
    ["cutoff_len", String(run.config.train.cutoff_len ?? "—")],
  ];
  lines.push("## 本轮训练超参");
  lines.push("");
  lines.push(mdTable(["参数", "取值"], trainRows));
  lines.push("");

  lines.push("## 指标");
  lines.push("");
  lines.push(
    mdTable(
      ["指标", "取值"],
      [
        ["n（预测条数）", s.n_pred ? String(s.n_pred) : "—"],
        ["BLEU-4", num(s.bleu4)],
        ["ROUGE-1", num(s.rouge1)],
        ["ROUGE-2", num(s.rouge2)],
        ["ROUGE-L", num(s.rougel)],
        ["exact_match", pct(s.exact_match)],
        ["copy_input_rate", pct(s.copy_input_rate)],
        ["repeat_rate", pct(s.repeat_rate)],
        ["empty_rate", pct(s.empty_rate)],
        ["预测/金标字数比", num(s.length_ratio, 3)],
        ["平均预测字数", num(s.mean_pred_chars, 1)],
        ["平均金标字数", num(s.mean_label_chars, 1)],
        ["eval_loss", num(s.eval_loss, 4)],
        ["train_loss", num(s.train_loss, 4)],
        ["epoch", num(s.epoch, 2)],
        ["global_step", s.global_step != null ? String(s.global_step) : "—"],
      ],
    ),
  );
  lines.push("");

  const extras = Object.entries(s.extras)
    .filter(([k]) => !/^(predict_|eval_|train_)/.test(k) || /runtime|samples_per_second/.test(k))
    .slice(0, 12);
  if (extras.length) {
    lines.push("## 其它记录");
    lines.push("");
    lines.push(mdTable(["键", "值"], extras.map(([k, v]) => [k, String(v)])));
    lines.push("");
  }

  if (s.samples.length) {
    lines.push("## 失败样例（预测 ≠ 金标）");
    lines.push("");
    for (const sample of s.samples) {
      lines.push(`- **输入**：${sample.input || "（未能从 prompt 抽出）"}`);
      lines.push(`  - 预测：${sample.predict || "（空）"}`);
      lines.push(`  - 金标：${sample.label || "（空）"}`);
    }
    lines.push("");
  }

  lines.push("## 训练参数建议");
  lines.push("");
  if (!run.suggestions.length) {
    lines.push("暂无自动建议。");
  } else {
    for (const item of run.suggestions) {
      const knobs = Object.entries(item.knobs)
        .map(([k, v]) => `\`${k}\`=${v}`)
        .join("，");
      lines.push(`### [${item.level}] ${item.title}`);
      lines.push("");
      lines.push(item.detail);
      if (knobs) {
        lines.push("");
        lines.push(`下一轮训练建议改：${knobs}`);
      }
      lines.push("");
    }
  }

  if (Object.keys(run.suggested_patch).length) {
    lines.push("合并后的下一轮超参：");
    lines.push("");
    lines.push("```yaml");
    for (const [k, v] of Object.entries(run.suggested_patch)) lines.push(`${k}: ${v}`);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

function sanitizeName(raw: string): string {
  const name = raw.trim().replace(/[^\w.\u4e00-\u9fff-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!name) throw new Error("run 名称无效");
  return name.slice(0, 80);
}

function defaultRunName(outputDir: string): string {
  const base = path.basename(path.resolve(outputDir)) || "run";
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
  return sanitizeName(`${base}-${ts}`);
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function slimSnapshot(snap: LfSnapshot): LfSnapshot {
  const log = snap.log.filter((p) => p.loss != null || p.eval_loss != null).slice(-200);
  return { ...snap, log };
}

function listRuns(runsDir: string): RunRecord[] {
  if (!fs.existsSync(runsDir)) return [];
  const names = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const rows: RunRecord[] = [];
  for (const name of names) {
    const rec = readJson<RunRecord>(path.join(runsDir, name, "run.json"));
    if (rec && rec.snapshot && typeof rec.score === "number") rows.push(rec);
  }
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return rows;
}

function renderCompareMarkdown(runs: RunRecord[], best: string | null): string {
  const lines: string[] = [];
  lines.push("# 模型验证对比");
  lines.push("");
  lines.push(`综合分：${RANKING_METRIC}`);
  lines.push("");
  if (!runs.length) {
    lines.push(
      "还没有已保存的 run。LlamaFactory 验证/预测结束后执行 `analyze --dir <output_dir> --save --train-config <yaml>`。",
    );
    lines.push("");
    return lines.join("\n");
  }
  lines.push(
    mdTable(
      ["run", "综合分", "BLEU-4", "ROUGE-L", "exact", "copy_input", "repeat", "lr", "epochs", "lora_rank"],
      runs.map((r) => {
        const mark = r.name === best ? " **best**" : "";
        const train = r.config.train || {};
        const s = r.snapshot;
        return [
          `${r.name}${mark}`,
          r.score.toFixed(4),
          num(s.bleu4),
          num(s.rougel),
          pct(s.exact_match),
          pct(s.copy_input_rate),
          pct(s.repeat_rate),
          String(train.learning_rate ?? "—"),
          String(train.num_train_epochs ?? "—"),
          String(train.lora_rank ?? "—"),
        ];
      }),
    ),
  );
  lines.push("");
  if (best) {
    lines.push(
      `当前最优训练配置：\`${best}\`，已复制到 \`reports/best/train_sft.yaml\`。下一轮建议见 \`reports/best/suggested_next.yaml\`。`,
    );
    lines.push("");
  }
  const notes = runs.filter((r) => r.config.note);
  if (notes.length) {
    lines.push("## 备注");
    lines.push("");
    for (const r of notes) lines.push(`- **${r.name}**：${r.config.note}`);
    lines.push("");
  }
  return lines.join("\n");
}

function promoteBest(cfg: ResolvedConfig, rec: RunRecord): void {
  const dir = cfg.paths.bestDir;
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, "run.json"), rec);
  writeJson(path.join(dir, "config.snapshot.json"), rec.config);
  writeJson(path.join(dir, "snapshot.json"), rec.snapshot);
  const srcYaml = rec.config.trainConfigPath;
  if (srcYaml && fs.existsSync(srcYaml)) {
    const yaml = fs.readFileSync(srcYaml, "utf8");
    fs.writeFileSync(path.join(dir, "train_sft.yaml"), yaml, "utf8");
    if (Object.keys(rec.suggested_patch || {}).length) {
      fs.writeFileSync(path.join(dir, "suggested_next.yaml"), patchTrainYaml(yaml, rec.suggested_patch), "utf8");
    }
  }
  const extra = rec.config.note ? `备注：${rec.config.note}\n` : "";
  fs.writeFileSync(
    path.join(dir, "README.md"),
    `# 最优训练配置：${rec.name}\n\n综合分 ${rec.score.toFixed(4)}，保存于 ${rec.saved_at}\n\n验证目录：\`${rec.config.outputDir}\`\n\n- \`train_sft.yaml\`：这一轮实际用过的训练配置，拿去复现。\n- \`suggested_next.yaml\`：根据本轮验证指标改过超参的下一轮建议。\n\n${extra}`,
    "utf8",
  );
}

function updateLeaderboard(cfg: ResolvedConfig, runs: RunRecord[]): Leaderboard {
  const ranked = [...runs].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const board: Leaderboard = {
    ranking_metric: RANKING_METRIC,
    best: ranked[0]?.name ?? null,
    ranking: runs.map((r) => ({ name: r.name, score: r.score, saved_at: r.saved_at })),
  };
  writeJson(cfg.paths.leaderboard, board);
  fs.writeFileSync(cfg.paths.compare, renderCompareMarkdown(runs, board.best), "utf8");
  if (ranked[0]) promoteBest(cfg, ranked[0]);
  return board;
}

function buildRun(cfg: ResolvedConfig, flags: AnalyzeFlags, snap: LfSnapshot, outputDir: string): RunRecord {
  const train = loadTrainFile(cfg, flags);
  const config = snapshotConfig(flags, train, outputDir);
  const { score, breakdown } = rankingScore(snap);
  const { suggestions, patch } = collectSuggestions(snap, config);
  return {
    name: sanitizeName(flags.name || defaultRunName(outputDir)),
    saved_at: new Date().toISOString(),
    score,
    score_breakdown: breakdown,
    snapshot: slimSnapshot(snap),
    config,
    suggestions,
    suggested_patch: patch,
  };
}

/** 分析 LlamaFactory 验证/预测目录，可选保存为一次 run，并更新对比榜 / 最优配置。 */
export function analyze(cfg: ResolvedConfig, flags: AnalyzeFlags = {}): RunRecord | null {
  if (flags.compare && !flags.save && !flags.dir) {
    const runs = listRuns(cfg.paths.runsDir);
    const board = updateLeaderboard(cfg, runs);
    console.log(`[analyze] best=${board.best ?? "—"} compare=${cfg.paths.compare}`);
    return runs[0] ?? null;
  }

  const outputDir = resolveOutputDir(cfg, flags);
  if (!outputDir) {
    throw new Error(
      "请用 --dir 指向评估写出的预测目录（默认 outputs/lf-predict，内含 predict_results.json 或 generated_predictions.jsonl）。不要填 outputs/train。",
    );
  }

  const snap = loadLfMetrics(outputDir);
  if (!snap.n_pred) applyGoldPredMetrics(snap, cfg.paths.eval, cfg.paths.pred);
  const run = buildRun(cfg, flags, snap, path.resolve(outputDir));
  const md = renderAnalysisMarkdown(run);

  fs.mkdirSync(path.dirname(cfg.paths.analysis), { recursive: true });
  fs.writeFileSync(cfg.paths.analysis, md, "utf8");
  const beside = fs.statSync(path.resolve(outputDir)).isDirectory()
    ? path.join(path.resolve(outputDir), "analysis.md")
    : path.join(path.dirname(path.resolve(outputDir)), "analysis.md");
  fs.writeFileSync(beside, md, "utf8");
  console.log(`[analyze] score=${run.score.toFixed(4)} md=${cfg.paths.analysis}`);
  console.log(`[analyze] also=${beside}`);
  for (const item of run.suggestions.filter((s) => s.level === "high").slice(0, 5)) {
    console.log(`[analyze] [${item.level}] ${item.title}`);
  }

  if (flags.save) {
    const dir = path.join(cfg.paths.runsDir, run.name);
    if (fs.existsSync(dir) && !flags.force) {
      throw new Error(`已存在 run ${run.name}，覆盖请加 --force`);
    }
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(dir, "run.json"), run);
    writeJson(path.join(dir, "snapshot.json"), run.snapshot);
    writeJson(path.join(dir, "config.snapshot.json"), run.config);
    fs.writeFileSync(path.join(dir, "analysis.md"), md, "utf8");
    const srcYaml = run.config.trainConfigPath;
    if (srcYaml && fs.existsSync(srcYaml)) {
      const yaml = fs.readFileSync(srcYaml, "utf8");
      fs.writeFileSync(path.join(dir, "train_sft.yaml"), yaml, "utf8");
      if (Object.keys(run.suggested_patch).length) {
        fs.writeFileSync(path.join(dir, "suggested_next.yaml"), patchTrainYaml(yaml, run.suggested_patch), "utf8");
      }
    }
    console.log(`[analyze] saved=${dir}`);
  }

  if (flags.save || flags.compare) {
    const runs = listRuns(cfg.paths.runsDir);
    if (runs.length) {
      const board = updateLeaderboard(cfg, runs);
      console.log(`[analyze] best=${board.best ?? "—"} compare=${cfg.paths.compare}`);
      if (board.best) console.log(`[analyze] bestDir=${cfg.paths.bestDir}`);
    } else if (flags.compare) {
      fs.writeFileSync(cfg.paths.compare, renderCompareMarkdown([], null), "utf8");
      console.log(`[analyze] compare=${cfg.paths.compare}（还没有已保存的 run）`);
    }
  }

  return run;
}
