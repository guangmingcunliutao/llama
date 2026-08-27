/**
 * termcorr 工作区配置（相对路径相对于本文件）。
 * 不要把本文件拷进 wx/。outDir 必须在 CLI 仓库外。
 *
 * sources 可并列多条 type: "http"；{{keyword}} 会换成当前正确词。
 * rate.requestsPerMinute 默认 5（约 12 秒一次），缓存命中不计入。
 */
export default {
  dict: "./data/term_pairs.jsonl",
  outDir: "./outputs",

  pairsPerTerm: 3,
  limitTerms: null,

  instruction: "请将句子中的不规范政治表述改正为规范表述，只输出改正后的句子。",
  formats: ["alpaca"],
  sentence: { minLen: 16, maxLen: 220 },
  rate: { requestsPerMinute: 5, jitterSec: 2 },

  sources: [
    {
      name: "people_search",
      type: "http",
      enabled: true,
      options: {
        url: "http://search.people.cn/search-platform/front/search",
        method: "POST",
        timeoutSec: 25,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json;charset=UTF-8",
          Origin: "http://search.people.cn",
          Referer:
            "http://search.people.cn/getNewsResult/?channel=cpc&x=10&y=11&keyword={{keyword}}",
        },
        body: {
          key: "{{keyword}}",
          page: 1,
          limit: 10,
          hasTitle: true,
          hasContent: true,
          isFuzzy: false,
          type: 7,
          domain: "cpc.people.com.cn",
          sources: null,
          sortType: 2,
          startTime: 0,
          endTime: 0,
        },
        recordsPath: "data.records",
        codePath: "code",
        okCodes: [0, 200, "0", "200", ""],
        fields: {
          html: ["contentOriginal", "content"],
          title: ["title"],
          url: ["url"],
          id: ["id", "contentId", "url"],
        },
      },
    },
  ],

  infer: {
    backend: "rule",
    http: {
      url: "http://127.0.0.1:8000/v1/chat/completions",
      model: "qwen2.5-0.5b",
      apiKeyEnv: "OPENAI_API_KEY",
    },
  },

  split: {
    unseenPairRatio: 0.1,
    seenPairEvalRatio: 0.1,
    minPairSizeForSeenEval: 2,
    keepRatio: 0.02,
    maxKeep: 400,
    seed: 42,
  },
};
