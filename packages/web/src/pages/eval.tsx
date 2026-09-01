/** 对独立验证集推理并计算指标。 */
import { Alert, Button, Card, Col, Empty, Form, Input, Row, Select, Space, Switch } from "antd";
import { useEffect, useState } from "react";
import { useJob } from "../jobs/JobContext";
import { ConfirmDangerButton } from "../ui/ConfirmDangerButton";
import { LogCard } from "../ui/LogCard";
import { PageHeader } from "../ui/PageHeader";

export const menu = { title: "评估", icon: "ExperimentOutlined", order: 30 };

export default function EvalPage() {
  const { job, start, cancel } = useJob();
  const [form] = Form.useForm();
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    void fetch("/api/config")
      .then((res) => res.json())
      .then((body: { data?: { infer?: { backend?: string; http?: { url?: string; model?: string } } } }) => {
        const infer = body.data?.infer ?? {};
        form.setFieldsValue({
          backend: infer.backend ?? "rule",
          url: infer.http?.url ?? "",
          model: infer.http?.model ?? "",
          all: true,
        });
      });
    void fetch("/api/reports")
      .then((res) => res.json())
      .then((body: { data?: { metrics?: Record<string, unknown> | null } }) => {
        setMetrics(body.data?.metrics ?? null);
      });
  }, [form, job.busy]);

  async function runInfer(): Promise<void> {
    const values = await form.validateFields();
    await start("/api/jobs/infer", values);
  }

  return (
    <>
      <PageHeader
        title="评估"
        description="对独立生成的验证集推理并打分。规则基线用于对照上界；http 可对接 LlamaFactory / vLLM 的 OpenAI 兼容接口。"
      />
      {job.error && !job.busy ? <Alert type="error" showIcon message={job.error} /> : null}
      <Card title="推理">
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="backend" label="后端">
                <Select
                  options={[
                    { value: "rule", label: "rule（词对替换基线）" },
                    { value: "http", label: "http（OpenAI 兼容）" },
                    { value: "file", label: "file（只导出待推理样本）" },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item name="url" label="接口 URL">
                <Input placeholder="http://127.0.0.1:8000/v1/chat/completions" />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="model" label="模型名">
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="all" label="评估全部切片" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </Form>
        <Space>
          <Button type="primary" disabled={job.busy} onClick={() => void runInfer()}>
            开始推理
          </Button>
          <Button disabled={job.busy} onClick={() => void start("/api/jobs/evaluate")}>
            计算指标
          </Button>
          <ConfirmDangerButton disabled={!job.busy} onConfirm={cancel} />
        </Space>
      </Card>
      <Card title="最近指标">
        {metrics ? (
          <pre className="report-pre">{JSON.stringify(metrics, null, 2)}</pre>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有 metrics.json。请先在数据页生成验证集，再用上方后端完成推理后点「计算指标」。"
          />
        )}
      </Card>
      <LogCard lines={job.logs} busy={job.busy} jobName={job.job} onStop={cancel} />
    </>
  );
}
