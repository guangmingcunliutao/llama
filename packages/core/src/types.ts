/**
 * model-training 公共类型。
 *
 * 工作区 `model-training.config.ts` 应对齐 {@link UserConfig}。
 * 加载后的规范化结果是 {@link ResolvedConfig}，命令实现只依赖后者。
 */
import type { ModelHub } from "./modelSource.js";

/** 字典中的一条错误词 / 正确词。 */
export interface TermPair {
  wrong: string;
  correct: string;
  error_type: string;
  freq: number;
}

/** 检索源返回的一篇文档（已去 HTML）。 */
export interface SourceDocument {
  source: string;
  doc_id: string;
  title: string;
  url: string;
  text: string;
  extra: Record<string, string>;
}

/**
 * 所有检索源必须实现的接口。
 * `remote: true` 的源会走请求频率限制；本地语料为 false。
 */
export interface SearchSource {
  readonly name: string;
  readonly remote: boolean;
  search(keyword: string): Promise<SourceDocument[]>;
}

/** 内置源类型。新增远程协议应扩这里，而不是为每个网站写一个类。 */
export type SourceType = "http" | "local_jsonl";

export type HttpMethod = "GET" | "POST";

/**
 * 从 HTTP JSON 里取正文的字段。
 * 写成数组表示按顺序尝试，取第一个非空值。
 */
export interface HttpExtractFields {
  html?: string | string[];
  title?: string | string[];
  url?: string | string[];
  id?: string | string[];
}

/**
 * 通用 HTTP 检索源。
 *
 * `url` / `headers` / `body` / `query` 里的 `{{keyword}}` 会替换成当前检索词。
 * 站点差异（人民网、其他检索接口）只体现在这份配置上，不写死在代码里。
 */
export interface HttpSourceOptions {
  /** 绝对 URL，可含 `{{keyword}}` */
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  /** POST 的 JSON 体 */
  body?: Record<string, unknown>;
  /** 拼到 URL 上的查询参数 */
  query?: Record<string, unknown>;
  /** 单次请求超时（秒） */
  timeoutSec?: number;
  /** 覆盖全局缓存目录；实际写入 `cacheDir/<sourceName>/` */
  cacheDir?: string;
  /** 记录数组的 JSON 路径，如 `data.records` */
  recordsPath?: string;
  /** 业务状态码路径，如 `code`；不设则只检查 HTTP 状态 */
  codePath?: string;
  /** 业务状态码视为成功的值 */
  okCodes?: Array<string | number>;
  fields?: HttpExtractFields;
  /** 覆盖全局 `rate.requestsPerMinute`，仅作用于这一条源 */
  requestsPerMinute?: number;
  /** 检索翻页次数，对应请求体里的 `page`（人民网等）。默认 1 */
  maxPages?: number;
}

export interface LocalJsonlSourceOptions {
  /** 语料文件，相对配置文件目录 */
  path: string;
  /** 每个关键词最多返回几篇 */
  limit?: number;
}

/**
 * 配置文件中的一条检索源。
 * 可同时启用多条，`generate` 按数组顺序尝试，某个源抽出句子后即换下一个词。
 * `type` 决定 `options` 的形状。
 */
export interface SourceConfigBase {
  /** 日志、缓存子目录用的名字，同一配置里须唯一 */
  name: string;
  /** 界面展示名；缺省时按 name 推导（人民网检索等） */
  title?: string;
  /** 界面说明，不参与检索逻辑 */
  description?: string;
  enabled?: boolean;
}

export interface HttpSourceConfig extends SourceConfigBase {
  type: "http";
  options: HttpSourceOptions;
}

export interface LocalJsonlSourceConfig extends SourceConfigBase {
  type: "local_jsonl";
  options: LocalJsonlSourceOptions;
}

export type SourceConfig = HttpSourceConfig | LocalJsonlSourceConfig;

/**
 * 远程请求频率。默认每分钟 5 次（间隔约 12 秒），降低被对方判为异常流量的概率。
 * 磁盘缓存命中不计入。
 */
export interface RateConfig {
  requestsPerMinute?: number;
  /**
   * 在最小间隔之上额外随机等待的秒数。
   * 默认 2，避免请求节奏过于机械。
   */
  jitterSec?: number;
  /**
   * @deprecated 已由 `requestsPerMinute` 替代。若仍出现，会按平均间隔换算。
   */
  sleepMin?: number;
  /** @deprecated 见 `sleepMin` */
  sleepMax?: number;
}

export interface SentenceConfig {
  minLen?: number;
  maxLen?: number;
}

export type InferBackend = "rule" | "http" | "file" | "llamafactory";

/** generate / split 可写出的训练语料格式。 */
export type SftFormat = "alpaca" | "sharegpt" | "messages";

export interface InferHttpConfig {
  url?: string;
  model?: string;
  /** 从该环境变量读 API Key，默认 OPENAI_API_KEY */
  apiKeyEnv?: string;
  /** @deprecated 请用 apiKeyEnv */
  api_key_env?: string;
}

export interface InferConfig {
  backend?: InferBackend;
  http?: InferHttpConfig;
}

export interface SplitConfig {
  /** 整组词对划入 eval_unseen_pair 的比例。 */
  unseenPairRatio?: number;
  /** 已见词对中抽去评估的句子比例（至少留 1 条训练）。 */
  seenPairEvalRatio?: number;
  /**
   * 词对至少几条才抽 seen 评估。默认 2。
   * pairsPerTerm=3 时若仍要求 ≥4，seen 评估集会几乎为空。
   */
  minPairSizeForSeenEval?: number;
  /** 从训练集正确句中抽「不应改动」样本的比例。 */
  keepRatio?: number;
  /** eval_keep 条数上限。 */
  maxKeep?: number;
  /** unseen 词对数量上限；null 表示不封顶。 */
  maxUnseenPairs?: number | null;
  /** 划分完成后训练集条数上限（试跑用，如 1000）。 */
  maxTrain?: number | null;
  seed?: number;
}

/**
 * LlamaFactory 训练超参（从 yaml 读出，不在配置文件里再写一遍）。
 */
export interface TrainHyperParams {
  model_name_or_path?: string;
  finetuning_type?: "lora" | "full" | "freeze";
  lora_rank?: number;
  lora_alpha?: number;
  lora_dropout?: number;
  lora_target?: string;
  learning_rate?: number | string;
  num_train_epochs?: number;
  /** -1 表示不限步数，按 epoch 走完数据 */
  max_steps?: number;
  lr_scheduler_type?: string;
  warmup_ratio?: number;
  per_device_train_batch_size?: number;
  gradient_accumulation_steps?: number;
  cutoff_len?: number;
  output_dir?: string;
  template?: string;
  bf16?: boolean;
  overwrite_output_dir?: boolean;
  save_steps?: number;
  save_total_limit?: number;
  resume_from_checkpoint?: string;
  adapter_name_or_path?: string;
}

/** yaml 解析结果，允许 null。 */
export type TrainKnobs = {
  [K in keyof TrainHyperParams]?: TrainHyperParams[K] | null;
};

/**
 * 工作区 `train` 只写路径。超参在 yaml 里，analyze 会去读。
 */
export interface TrainConfig {
  /** 本轮实际使用的 LlamaFactory 训练 yaml（相对配置文件） */
  config?: string;
  /** 训练 checkpoint / LoRA 目录（评估页加载模型用）。调参读的是 `outputs/lf-predict`，不要把这两处混成同一个路径。 */
  outputDir?: string;
}

/** 工作区配置文件的形状（加载前）。 */
export interface UserConfig {
  dict?: string;
  dict_path?: string;
  outDir?: string;
  out_dir?: string;
  cacheDir?: string;
  cache_dir?: string;
  pairsPerTerm?: number;
  limitTerms?: number | null;
  /** 混入 input=output 的正常样本比例，0~1，默认 0.1 */
  cleanRatio?: number;
  /** 每个检索词最多翻页数 */
  maxPages?: number;
  instruction?: string;
  /** 写出的训练格式，默认 messages。也可 alpaca / sharegpt。 */
  formats?: SftFormat[] | string;
  sentence?: SentenceConfig;
  rate?: RateConfig;
  sources?: SourceConfig[];
  infer?: InferConfig;
  split?: SplitConfig;
  train?: TrainConfig;
  /** 外部语料导入（import 命令） */
  import?: { source?: string; limit?: number | null };
  importSource?: string;
  importLimit?: number | null;
  /** LlamaFactory 数据集导出（export-lf 命令） */
  llamafactory?: {
    /** LLaMA-Factory 仓库或安装根目录（含 src/llamafactory 或 .venv） */
    home?: string;
    /** 可选，直接指定 llamafactory-cli 可执行文件 */
    bin?: string;
    datasetDir?: string;
    datasetInfo?: string;
    prefix?: string;
    /** 基座模型来源：local / huggingface / modelscope / openmind */
    hub?: string;
    /** 记住的底模：本地目录或仓库 ID */
    model?: string;
    /** Hugging Face 镜像，如 https://hf-mirror.com */
    hfEndpoint?: string;
    /** 线上模型下载缓存（建议与仓库同盘） */
    modelCacheDir?: string;
  };
  lfDatasetDir?: string | null;
  lfDatasetInfo?: string;
  lfPrefix?: string;
}

export interface UserConfigContext {
  command: string;
  mode: string;
  cwd: string;
}

export type UserConfigFn = (ctx: UserConfigContext) => UserConfig | Promise<UserConfig>;
export type UserConfigExport = UserConfig | UserConfigFn;

export interface OutputPaths {
  dict: string | null;
  sft: string;
  sftSharegpt: string;
  trainSplit: string;
  trainSplitSharegpt: string;
  eval: string;
  evalSeen: string;
  evalUnseen: string;
  evalKeep: string;
  pred: string;
  predSeen: string;
  predUnseen: string;
  predKeep: string;
      metrics: string;
      scored: string;
      splitReport: string;
      analysis: string;
      compare: string;
      runsDir: string;
      bestDir: string;
      leaderboard: string;
  lfPredict: string;
  evalLf: string;
  predictYaml: string;
}

export interface ResolvedRateConfig {
  requestsPerMinute: number;
  jitterSec: number;
}

export interface ResolvedHttpSource {
  name: string;
  title: string;
  description: string;
  type: "http";
  enabled: boolean;
  options: HttpSourceOptions;
}

export interface ResolvedLocalSource {
  name: string;
  title: string;
  description: string;
  type: "local_jsonl";
  enabled: boolean;
  options: LocalJsonlSourceOptions;
}

export type ResolvedSource = ResolvedHttpSource | ResolvedLocalSource;

/** 加载、解析路径与默认值之后的配置。命令层只使用这个类型。 */
export interface ResolvedConfig {
  command: string;
  cwd: string;
  root: string;
  configFile: string;
  outDir: string;
  cacheDir: string;
  dict: string | null;
  pairsPerTerm: number;
  limitTerms: number | null;
  cleanRatio: number;
  maxPages: number;
  instruction: string;
  formats: SftFormat[];
  sentence: { minLen: number; maxLen: number };
  rate: ResolvedRateConfig;
  sources: ResolvedSource[];
  infer: InferConfig;
  split: Required<Omit<SplitConfig, "maxTrain" | "maxUnseenPairs">> & {
    maxTrain: number | null;
    maxUnseenPairs: number | null;
  };
  /** 训练 yaml 绝对路径；没有则为 null。 */
  trainConfig: string | null;
  /** LlamaFactory 验证/预测 output_dir；没有则为 null。 */
  trainOutputDir: string | null;
  importSource: string | null;
  importLimit: number | null;
  lfDatasetDir: string | null;
  lfDatasetInfo: string;
  lfPrefix: string;
  lfHome: string | null;
  lfBin: string | null;
  lfHub: ModelHub;
  lfModel: string | null;
  lfHfEndpoint: string | null;
  lfModelCacheDir: string | null;
  paths: OutputPaths;
}

/** generate 写出的一条 SFT 句对。 */
export interface SftExample {
  instruction: string;
  input: string;
  output: string;
  error_type: string;
  wrong: string;
  correct: string;
  source: string;
  url: string;
  article_id: string;
  split?: string;
  id?: string | number;
  freq?: number;
  freq_bucket?: string;
}

export interface PredictionRow {
  id: string | number;
  pred: string;
}

export interface GenerateFlags {
  dict?: string;
  pairsPerTerm?: string | number;
  limitTerms?: string | number | null;
  source?: string;
  sources?: string[];
  output?: string;
  format?: string;
  instruction?: string;
  cleanRatio?: string | number;
  maxPages?: string | number;
  seed?: string | number;
  signal?: AbortSignal;
  mode?: "fresh" | "resume" | "continue";
  runId?: string;
  parentId?: string;
  label?: string;
}

export interface ImportFlags {
  input?: string;
  output?: string;
  limit?: number | null;
}

export interface ImportResult {
  input: string;
  output: string;
  count: number;
}

export interface ExportLfFlags {
  datasetDir?: string;
  datasetInfo?: string;
  prefix?: string;
  /** alpaca / sharegpt / alpaca,sharegpt；默认跟随配置，缺省为 alpaca（.jsonl） */
  format?: string;
}

export interface ExportLfResult {
  datasetDir: string;
  datasetInfo: string;
  prefix: string;
  datasets: string[];
  files: Record<string, string>;
  formats: SftFormat[];
}

export interface SplitFlags {
  input?: string;
  trainOut?: string;
  evalOut?: string;
}

export interface InferFlags {
  input?: string;
  output?: string;
  backend?: string;
  url?: string;
  model?: string;
  adapter?: string;
  home?: string;
  bin?: string;
  hub?: string;
  hfEndpoint?: string;
  all?: boolean;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
}

export interface EvaluateFlags {
  gold?: string;
  pred?: string;
  output?: string;
  all?: boolean;
}

export interface SuiteFlags {
  backend?: string;
  url?: string;
  model?: string;
}

export interface AnalyzeFlags {
  name?: string;
  note?: string;
  save?: boolean;
  compare?: boolean;
  force?: boolean;
  trainConfig?: string;
  /** LlamaFactory 验证/预测输出目录（含 predict_results.json、generated_predictions.jsonl） */
  dir?: string;
}

export interface GenerateResult {
  written: number;
  output: string;
  sharegpt?: string;
}

export interface SplitSliceCounts {
  train: number;
  eval_seen_pair: number;
  eval_unseen_pair: number;
  eval_keep: number;
}

export interface SplitReport {
  input: string;
  outDir: string;
  total: number;
  unique_pairs: number;
  train: number;
  eval: number;
  eval_seen_pair: number;
  eval_unseen_pair: number;
  eval_keep: number;
  unseen_pairs: number;
  seen_pairs_eligible: number;
  dropped_train_leakage: number;
  dropped_eval_seen_leakage: number;
  dropped_eval_unseen_leakage: number;
  min_pair_size_for_seen_eval: number;
  by_error_type: Record<string, SplitSliceCounts>;
  by_freq_bucket: Record<string, SplitSliceCounts>;
  files: {
    train: string;
    eval: string;
    eval_seen_pair: string;
    eval_unseen_pair: string;
    eval_keep: string;
  };
  train_sharegpt?: string;
}

export interface MetricsGroup {
  n: number;
  exact_match: number;
  term_fix_rate: number;
  only_term_change: number;
  over_edit_rate: number;
  copy_input_rate: number;
  empty_rate: number;
}

export interface MetricsReport extends MetricsGroup {
  gold: string;
  pred: string;
  scored: string;
  by_split: Record<string, MetricsGroup>;
  by_error_type: Record<string, MetricsGroup>;
  by_freq_bucket: Record<string, MetricsGroup>;
  slices?: Record<string, MetricsGroup>;
}

export interface ConfigSnapshot {
  kind: "model";
  train: TrainKnobs;
  trainConfigPath: string | null;
  outputDir: string;
  note?: string;
}

export interface Suggestion {
  level: "high" | "mid" | "low";
  title: string;
  detail: string;
  knobs: Record<string, string | number>;
}

export interface RunRecord {
  name: string;
  saved_at: string;
  score: number;
  score_breakdown: Record<string, number>;
  snapshot: import("./lfMetrics.js").LfSnapshot;
  config: ConfigSnapshot;
  suggestions: Suggestion[];
  suggested_patch: Record<string, string | number>;
}

export interface Leaderboard {
  ranking_metric: string;
  best: string | null;
  ranking: Array<{ name: string; score: number; saved_at: string }>;
}

export type CliCommand =
  | "init"
  | "prepare"
  | "generate"
  | "split"
  | "evaluate"
  | "infer"
  | "suite"
  | "analyze"
  | "sources";
