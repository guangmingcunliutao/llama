/** 用训练后的模型对验证集推理并打分。 */
import { Alert, Button, Card, Collapse, Empty, Form, Select, Space, Typography } from "antd";
import { App as AntdApp } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useJob } from "../jobs/JobContext";
import { useRuns } from "../runs/useRuns";
import { ConfirmDangerButton } from "../ui/ConfirmDangerButton";
import { LogCard } from "../ui/LogCard";
import { PageHeader } from "../ui/PageHeader";
import { PipelineStrip } from "../ui/PipelineStrip";

export const menu = { title: "评估", icon: "ExperimentOutlined", order: 30 };

export default function EvalPage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const { job, start, cancel } = useJob(["infer", "evaluate"]);
  const trainRuns = useRuns("train");
  const [form] = Form.useForm();
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null);
  const trainRunId = Form.useWatch("trainRunId", form) as string | undefined;
  const selectedTrain = trainRuns.rows.find((row) => row.id === trainRunId);

  function evalBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const id = String(form.getFieldValue("trainRunId") ?? trainRuns.selectedId ?? "").trim();
    const row = trainRuns.rows.find((item) => item.id === id);
    return {
      trainRunId: id || undefined,
      dataRunId: row?.dataRunId || undefined,
      ...extra,
    };
  }

  useEffect(() => {
    void (async () => {
      const [cfgRes, reportRes] = await Promise.all([fetch("/api/config"), fetch("/api/reports")]);
      const cfgBody = (await cfgRes.json()) as {
        data?: { train?: { outputDir?: string } };
      };
      const reportBody = (await reportRes.json()) as { data?: { metrics?: Record<string, unknown> | null } };
      form.setFieldsValue({
        trainRunId: cfgBody.data && trainRuns.selectedId ? trainRuns.selectedId : trainRuns.rows.find((r) => r.adapterReady)?.id,
      });
      setMetrics(reportBody.data?.metrics ?? null);
    })();
  }, [form, job.busy, trainRuns.selectedId, trainRuns.rows]);

  async function runModelEval(): Promise<void> {
    const id = String(form.getFieldValue("trainRunId") ?? trainRuns.selectedId ?? "").trim();
    if (!id) {
      message.warning("请选择一次训练实验");
      return;
    }
    await start("/api/jobs/infer", evalBody({ backend: "llamafactory", all: true }));
  }

  return (
    <>
      <PageHeader
        title="评估"
        description="用某次训练实验的 LoRA 改验证集句子，计算纠错分数。"
      />
      <PipelineStrip />
      {job.error && !job.busy ? <Alert type="error" showIcon message={job.error} /> : null}
      <Card title="训练模型">
        <Form form={form} layout="vertical" disabled={job.busy}>
          <Form.Item
            name="trainRunId"
            label="训练实验"
            extra={
              selectedTrain?.dataRunId
                ? `目录里有 adapter 的实验才能评估。验证集用这次训练绑定的数据实验 ${selectedTrain.dataRunId}，与正在生成的新数据无关。`
                : "目录里有 adapter 的实验才能评估。验证集跟所选训练实验走，不跟正在准备的新数据走。"
            }
          >
            <Select
              placeholder="选择训练实验"
              options={trainRuns.rows.map((row) => ({
                value: row.id,
                label: `${row.label}（${row.status}${row.adapterReady ? " · adapter" : ""}）`,
                disabled: !row.adapterReady && row.status !== "completed",
              }))}
            />
          </Form.Item>
        </Form>
        <Typography.Paragraph type="secondary">
          加载该目录中的模型，对验证集做生成，写出预测和 metrics.json。
        </Typography.Paragraph>
        <Space wrap>
          <Button type="primary" htmlType="button" disabled={job.busy} onClick={() => void runModelEval()}>
            开始评估
          </Button>
          <Button htmlType="button" onClick={() => navigate("/analyze")}>
            下一步：调参
          </Button>
          <ConfirmDangerButton disabled={!job.busy} onConfirm={cancel} />
        </Space>
        <Collapse
          style={{ marginTop: 16 }}
          items={[
            {
              key: "more",
              label: "已有预测时仅打分 / 规则上界（对照）",
              children: (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    已有预测时仅打分：不加载模型，用当前评估实验的 pred.jsonl 重新算分；若当前实验还没有预测，会改用最近一次已有预测的实验。规则上界：按词表把错词换成正词，用来估计上限，会覆盖页面上的模型分数。
                  </Typography.Paragraph>
                  <Space wrap>
                    <Button
                      htmlType="button"
                      disabled={job.busy}
                      onClick={() => void start("/api/jobs/evaluate", evalBody())}
                    >
                      已有预测时仅打分
                    </Button>
                    <Button
                      htmlType="button"
                      disabled={job.busy}
                      onClick={() => void start("/api/jobs/infer", evalBody({ backend: "rule", baseline: true, all: true }))}
                    >
                      规则上界（对照）
                    </Button>
                  </Space>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Card title="纠错指标">
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          exact_match：整句与标准答案一致。term_fix_rate：该改的词改对了。copy_input_rate：原样复述错句。keep：本身正确的句子不应被改坏。
        </Typography.Paragraph>
        {metrics ? (
          <pre className="report-pre">{JSON.stringify(metrics, null, 2)}</pre>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有指标。请先有验证集和训练产出，再点「开始评估」。" />
        )}
      </Card>
      <LogCard lines={job.logs} busy={job.busy} jobName={job.job} onStop={cancel} />
    </>
  );
}
