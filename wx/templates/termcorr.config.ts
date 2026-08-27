import { defineConfig } from "termcorr";

/**
 * termcorr 工作区配置。
 *
 * - 产物默认写到 outDir（./outputs）
 * - 评估切片 seen / unseen / keep 说明见同目录 split-slices.md
 * - 微调在 LlamaFactory；本工具只负责数据与评估
 */
export default defineConfig({
  outDir: "./outputs",

  instruction:
    "请将句子中的不规范表述改正为规范表述，只输出改正后的句子。",

  /** 字典路径（prepare 产出或自备 jsonl） */
  dict: "./data/term_pairs.jsonl",

  /** 从外部语料导入时使用（pipeline / import） */
  // import: {
  //   source: "./data/raw.json",
  //   limit: null,
  // },

  split: {
    /** 约 10% 词对整组不进训练 → eval_unseen */
    unseenPairRatio: 0.1,
    /** 词对至少 2 条时，约 10% 句子进 eval_seen */
    seenPairEvalRatio: 0.1,
    minPairSizeForSeenEval: 2,
    /** 从训练池抽「无需改动」句 → eval_keep */
    keepRatio: 0.02,
    maxKeep: 400,
    seed: 42,
  },

  /** 导出到 LlamaFactory dataset_dir（export-lf / pipeline） */
  // llamafactory: {
  //   datasetDir: "../my_datasets",
  //   datasetInfo: "dataset_info.json",
  //   prefix: "corr",
  // },

  /** analyze 用：本轮训练 yaml 与 output_dir */
  // train: {
  //   config: "./train_sft.yaml",
  //   outputDir: "./lf_output",
  // },

  /** infer 后端：rule | http | file */
  infer: {
    backend: "rule",
    // http: {
    //   url: "http://127.0.0.1:8000/v1/chat/completions",
    //   model: "your-model",
    // },
  },

  /** 检索源（generate 用） */
  sources: [
    {
      name: "people_search",
      type: "http",
      enabled: true,
      options: {
        url: "http://search.people.cn/search/s?keyword={keyword}&st=0&_=1",
        keywordParam: "keyword",
      },
    },
  ],

  rate: {
    requestsPerMinute: 5,
    jitterSec: 2,
  },
});
