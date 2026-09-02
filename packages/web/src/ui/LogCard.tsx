import { useEffect, useRef } from "react";
import { Card } from "antd";
import { ConfirmDangerButton } from "./ConfirmDangerButton";

export const JOB_LABEL: Record<string, string> = {
  generate: "数据生成",
  "generate-eval": "验证集生成",
  train: "训练",
  infer: "推理",
  evaluate: "评估",
  analyze: "分析",
  "lf-install": "安装 LlamaFactory",
};

/**
 * 本页相关任务的日志。不同任务可以并行，同名任务同时只能一个。
 */
export function LogCard({
  lines,
  busy,
  jobName,
  onStop,
}: {
  lines: string[];
  busy?: boolean;
  jobName?: string | null;
  onStop?: () => void | Promise<void>;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const label = jobName ? (JOB_LABEL[jobName] ?? jobName) : null;
  const title = busy && label ? `运行中 · ${label}` : "任务日志";

  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <Card
      size="small"
      className="log-term-card"
      title={title}
      extra={
        onStop ? (
          <ConfirmDangerButton disabled={!busy} onConfirm={onStop} />
        ) : null
      }
    >
      <div className="log-term">
        <div className="log-term-chrome">
          <span className="log-term-dot" />
          <span className="log-term-dot" />
          <span className="log-term-dot" />
          <span className="log-term-path">mtrain@{busy ? label ?? "job" : "idle"}</span>
        </div>
        <pre ref={preRef} className="log-pre">
          {lines.length
            ? lines.join("\n")
            : "# 空闲。启动生成 / 训练 / 评估后，输出会写在这里。\n# 全站共用同一任务槽，切到其他页看到的是同一份日志。"}
        </pre>
      </div>
    </Card>
  );
}
