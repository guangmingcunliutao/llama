import { defineConfig } from "@model-training/core";

/**
 * 仓库根或工作区配置。CLI 与 Web 共用这一份。
 */
export default defineConfig({
  outDir: "./outputs",
  cacheDir: "./cache",
  instruction: "请将句子中的不规范表述改正为规范表述，只输出改正后的句子。",
  dict: "./data/term_pairs.jsonl",
  formats: ["messages"],
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
      options: {
        url: "http://search.people.cn/search-pc/news?keyword={{keyword}}",
        method: "GET",
      },
    },
  ],
});
