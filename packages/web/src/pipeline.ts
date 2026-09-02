/** 侧栏流程：每一步只做一件事。 */
export const PIPELINE = [
  {
    path: "/data",
    title: "数据生成",
    blurb: "词对与句对",
    detail: "上传错词/正词表，检索真实句子。训练集和验证集分开生成，句子不重复。",
  },
  {
    path: "/train",
    title: "训练",
    blurb: "LoRA 微调",
    detail: "用训练集微调底模。结果在 outputs/train。",
  },
  {
    path: "/eval",
    title: "评估",
    blurb: "纠错打分",
    detail: "用训好的模型改验证集句子，计算纠错分数。",
  },
  {
    path: "/analyze",
    title: "调参",
    blurb: "超参建议",
    detail: "不重新跑模型。读取评估留下的预测，给出下一轮学习率等建议。",
  },
  {
    path: "/quant",
    title: "量化导出",
    blurb: "GGUF 导出",
    detail: "把权重转成更小的部署格式。",
  },
] as const;
