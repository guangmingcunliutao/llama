/** 侧栏流程：每一步只做一件事。 */
export const PIPELINE = [
  {
    path: "/data",
    title: "数据生成",
    blurb: "词对与句对",
    detail: "准备训练/验证集后打开 LlamaFactory 训练和评估。",
  },
  {
    path: "/analyze",
    title: "调参",
    blurb: "对比超参",
    detail: "对比多次评估结果，看哪组训练参数纠错更好。",
  },
  {
    path: "/quant",
    title: "量化导出",
    blurb: "GGUF 导出",
    detail: "把权重转成更小的部署格式。",
  },
] as const;
