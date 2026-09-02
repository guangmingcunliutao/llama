/** 读取评估实验的预测目录，给出下一轮超参建议。不重新跑模型。 */
import { Alert, Button, Card, Checkbox, Empty, Form, Input, Select, Space } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useJob } from "../jobs/JobContext";
import { useRuns } from "../runs/useRuns";
import { ConfirmDangerButton } from "../ui/ConfirmDangerButton";
import { LogCard } from "../ui/LogCard";
import { PageHeader } from "../ui/PageHeader";
import { PipelineStrip } from "../ui/PipelineStrip";

export const menu = { title: "调参", icon: "BarChartOutlined", order: 40 };

export default function AnalyzePage() {
  const navigate = useNavigate();
  const { job, start, cancel } = useJob("analyze");
  const evalRuns = useRuns("eval");
  const trainRuns = useRuns("train");
  const [form] = Form.useForm();
  const [markdown, setMarkdown] = useState("");
  const locked = job.busy;

  useEffect(() => {
    if (locked) return;
    const evalId = evalRuns.selectedId ?? evalRuns.rows[0]?.id ?? "";
    const trainId =
      trainRuns.selectedId ?? trainRuns.rows.find((row) => row.adapterReady)?.id ?? trainRuns.rows[0]?.id ?? "";
    const evalRow = evalRuns.rows.find((row) => row.id === evalId);
    const trainRow = trainRuns.rows.find((row) => row.id === trainId);
    if (!evalId && !trainId) return;
    form.setFieldsValue({
      evalRunId: evalId || undefined,
      trainRunId: trainId || undefined,
      dir: evalRow?.lfPredict ?? "",
      trainConfig: trainRow?.yamlPath ?? "",
    });
  }, [form, locked, evalRuns.selectedId, evalRuns.rows, trainRuns.selectedId, trainRuns.rows]);

  useEffect(() => {
    if (locked) return;
    void fetch("/api/reports")
      .then((res) => res.json())
      .then((body: { data?: { analysis?: string | null; compare?: string | null } }) => {
        setMarkdown(body.data?.analysis || body.data?.compare || "");
      });
  }, [locked]);

  async function run(): Promise<void> {
    const values = await form.validateFields();
    await start("/api/jobs/analyze", {
      dir: String(values.dir ?? "").trim(),
      trainConfig: String(values.trainConfig ?? "").trim(),
      name: values.name,
      note: values.note,
      save: values.save === true,
      compare: values.compare === true,
    });
  }

  return (
    <>
      <PageHeader
        title="调参"
        description="不加载模型。读取当前评估实验的预测，对照本轮训练 yaml，给出下一轮超参建议。"
      />
      <PipelineStrip />
      {job.error && !job.busy ? <Alert type="error" showIcon message={job.error} /> : null}
      <Card title="预测" extra={locked ? "调参进行中，参数已锁定" : undefined}>
        <Form form={form} layout="vertical" disabled={locked} initialValues={{ save: true, compare: true }}>
          <Form.Item name="evalRunId" label="评估实验" extra="预测写在 outputs/eval/<id>/lf-predict。">
            <Select
              placeholder="选择评估实验"
              options={evalRuns.rows.map((row) => ({
                value: row.id,
                label: `${row.label}（${row.status}）`,
              }))}
              onChange={(id) => {
                const row = evalRuns.rows.find((item) => item.id === id);
                form.setFieldValue("dir", row?.lfPredict ?? "");
              }}
            />
          </Form.Item>
          <Form.Item
            name="dir"
            label="预测输出目录"
            rules={[{ required: true, message: "请先完成评估，或填写预测目录" }]}
          >
            <Input placeholder="outputs/eval/<id>/lf-predict" />
          </Form.Item>
          <Form.Item name="trainRunId" label="训练实验" extra="本轮实际写出的 train.yaml。">
            <Select
              placeholder="选择训练实验"
              options={trainRuns.rows.map((row) => ({
                value: row.id,
                label: `${row.label}（${row.status}${row.adapterReady ? " · adapter" : ""}）`,
              }))}
              onChange={(id) => {
                const row = trainRuns.rows.find((item) => item.id === id);
                form.setFieldValue("trainConfig", row?.yamlPath ?? "");
              }}
            />
          </Form.Item>
          <Form.Item name="trainConfig" label="本轮训练 yaml" rules={[{ required: true, message: "请选择训练实验" }]}>
            <Input placeholder="outputs/train/<id>/train.yaml" />
          </Form.Item>
          <Form.Item name="name" label="run 名称">
            <Input placeholder="如 stage1" />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space>
            <Form.Item name="save" valuePropName="checked" noStyle>
              <Checkbox>保存本轮并刷新最优配置</Checkbox>
            </Form.Item>
            <Form.Item name="compare" valuePropName="checked" noStyle>
              <Checkbox>重写 compare.md</Checkbox>
            </Form.Item>
          </Space>
        </Form>
        <Space style={{ marginTop: 16 }} wrap>
          <Button type="primary" htmlType="button" disabled={locked} onClick={() => void run()}>
            开始调参
          </Button>
          <Button htmlType="button" onClick={() => navigate("/eval")}>
            返回评估
          </Button>
          <ConfirmDangerButton disabled={!locked} onConfirm={cancel} />
        </Space>
      </Card>
      <Card title="调参报告">
        {markdown ? (
          <pre className="report-pre">{markdown}</pre>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有报告。请先评估，再对本页当前评估实验点「开始调参」。"
          />
        )}
      </Card>
      <LogCard lines={job.logs} busy={job.busy} jobName={job.job} onStop={cancel} />
    </>
  );
}
