/** 用训练后的模型对验证集推理并打分。 */
import { Alert, Button, Card, Collapse, Empty, Form, Input, Space, Typography } from "antd";
import { App as AntdApp } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useJob } from "../jobs/JobContext";
import { ConfirmDangerButton } from "../ui/ConfirmDangerButton";
import { LogCard } from "../ui/LogCard";
import { PageHeader } from "../ui/PageHeader";
import { PipelineStrip } from "../ui/PipelineStrip";

export const menu = { title: "评估", icon: "ExperimentOutlined", order: 30 };

export default function EvalPage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const { job, start, cancel, isBusy } = useJob(["infer", "evaluate"]);
  const [form] = Form.useForm();
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    void (async () => {
      const [cfgRes, reportRes] = await Promise.all([fetch("/api/config"), fetch("/api/reports")]);
      const cfgBody = (await cfgRes.json()) as {
        data?: { train?: { outputDir?: string } };
      };
      const reportBody = (await reportRes.json()) as { data?: { metrics?: Record<string, unknown> | null } };
      form.setFieldsValue({
        adapter: cfgBody.data?.train?.outputDir ?? "./outputs/train",
      });
      setMetrics(reportBody.data?.metrics ?? null);
    })();
  }, [form, job.busy]);

  async function runModelEval(): Promise<void> {
    const adapter = String(form.getFieldValue("adapter") ?? "").trim();
    if (!adapter) {
      message.warning("请填写训练输出目录");
      return;
    }
    await start("/api/jobs/infer", {
      backend: "llamafactory",
      adapter,
      all: true,
    });
  }

  return (
    <>
      <PageHeader
        title="评估"
        description="用训练后的模型改验证集句子，计算纠错分数。日常点「开始评估」即可。改下一轮超参请去「调参」。"
      />
      <PipelineStrip />
      {job.error && !job.busy ? <Alert type="error" showIcon message={job.error} /> : null}
      <Card title="训练模型">
        <Form form={form} layout="vertical" initialValues={{ adapter: "./outputs/train" }}>
          <Form.Item
            name="adapter"
            label="训练输出目录"
            extra="一般是 outputs/train。目录里有 adapter_config.json 时按 LoRA 加载。"
          >
            <Input placeholder="./outputs/train" />
          </Form.Item>
        </Form>
        <Typography.Paragraph type="secondary">
          加载该目录中的模型，对验证集做生成，写出预测和 metrics.json。
        </Typography.Paragraph>
        <Space wrap>
          <Button type="primary" htmlType="button" disabled={isBusy("infer")} onClick={() => void runModelEval()}>
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
                    已有预测时仅打分：不加载模型，只用已有 pred.jsonl 重新算分。规则上界：按词表把错词换成正词，用来估计上限，会覆盖页面上的模型分数。
                  </Typography.Paragraph>
                  <Space wrap>
                    <Button
                      htmlType="button"
                      disabled={isBusy("evaluate")}
                      onClick={() => void start("/api/jobs/evaluate")}
                    >
                      已有预测时仅打分
                    </Button>
                    <Button
                      htmlType="button"
                      disabled={isBusy("infer")}
                      onClick={() => void start("/api/jobs/infer", { backend: "rule", baseline: true, all: true })}
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
