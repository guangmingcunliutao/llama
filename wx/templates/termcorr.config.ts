import { defineConfig } from "termcorr";

/**
 * termcorr 工作区配置。
 *
 * - defineConfig 由 CLI 在加载时解析，无需在工作区 pnpm install
 * - 评估切片说明见 llama/wx/docs/split-slices.md
 */
export default defineConfig({
  outDir: "./outputs",

  instruction:
    "请将句子中的不规范表述改正为规范表述，只输出改正后的句子。",

  dict: "./data/term_pairs.jsonl",

  split: {
    unseenPairRatio: 0.1,
    seenPairEvalRatio: 0.1,
    minPairSizeForSeenEval: 2,
    keepRatio: 0.02,
    maxKeep: 400,
    seed: 42,
  },

  infer: {
    backend: "rule",
  },

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
