import type { UserConfig } from "./types.js";
import { PEOPLE_SEARCH_HTTP } from "./sources/peopleDefaults.js";

export function defaultUserConfig(): UserConfig {
  return {
    outDir: "./outputs",
    cacheDir: "./cache",
    dict: "./data/term_pairs.jsonl",
    formats: ["messages"],
    instruction:
      "请将句子中的不规范表述改正为规范表述，若没有错误则原样输出该句子。只输出句子本身。",
    pairsPerTerm: 3,
    cleanRatio: 0.1,
    maxPages: 3,
    sentence: { minLen: 16, maxLen: 220 },
    train: {
      config: "./outputs/llamafactory/train_sft.yaml",
      outputDir: "./outputs/train",
    },
    llamafactory: {
      datasetDir: "./outputs/lf",
      prefix: "term",
      home: "",
    },
    sources: [
      {
        name: "people_search",
        title: "人民网检索",
        description: "检索 cpc.people.com.cn 文章标题与正文，按书写变体精确匹配含正确词的真实句子",
        type: "http",
        enabled: true,
        options: { ...PEOPLE_SEARCH_HTTP },
      },
    ],
    rate: { requestsPerMinute: 5, jitterSec: 2 },
    infer: { backend: "rule" },
  };
}
