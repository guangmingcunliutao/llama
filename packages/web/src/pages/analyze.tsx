/** 读取评估预测，对比多次训练哪组超参更好。 */
import { Alert, Button, Card, Checkbox, Empty, Form, Input, Select, Space, Table, Typography } from "antd";
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
  const [compareRows, setCompareRows] = useState<
    Array<{
      name: string;
      score: number;
      bleu4: number | null;
      rougel: number | null;
      exactMatch: number | null;
      copyInput: number | null;
      repeat: number | null;
      learningRate: string | number | null;
      epochs: number | null;
      loraRank: number | null;
      cutoffLen: number | null;
      dataFingerprint: string | null;
      nPred: number;
    }>
  >([]);
  const locked = job.busy;
  const fingerprints = [...new Set(compareRows.map((row) => row.dataFingerprint).filter(Boolean))];
  const mixedData = fingerprints.length > 1;

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
      .then((body: { data?: { analysis?: string | null; compare?: string | null; compareRuns?: typeof compareRows } }) => {
        setMarkdown(body.data?.analysis || body.data?.compare || "");
        setCompareRows(body.data?.compareRuns ?? []);
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
        description="把评估预测存成一次对比记录。没有逐条预测的不会进综合分。哪组超参更好看下表，不要用 SwanLab 离线看板当选参依据。"
      />
      <PipelineStrip />
      {job.error && !job.busy ? <Alert type="error" showIcon message={job.error} /> : null}
      {mixedData ? (
        <Alert
          type="warning"
          showIcon
          message="对比里混了不同数据指纹的实验，分数不能直接比超参。"
          style={{ marginBottom: 16 }}
        />
      ) : null}
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
          <Form.Item name="trainConfig" label="本轮训练 yaml（可空）">
            <Input placeholder="有 yaml 就填，LlamaFactory WebUI 训的可以留空" />
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
          <Button htmlType="button" onClick={() => navigate("/data")}>
            返回数据
          </Button>
          <ConfirmDangerButton disabled={!locked} onConfirm={cancel} />
        </Space>
      </Card>
      <Card title="哪组参数更好" extra="综合分越高越好。仅含有逐条预测的记录。">
        {compareRows.length ? (
          <Table
            rowKey="name"
            size="small"
            pagination={false}
            dataSource={compareRows}
            columns={[
              { title: "run", dataIndex: "name", ellipsis: true },
              {
                title: "综合分",
                dataIndex: "score",
                width: 100,
                render: (v: number, _row, index: number) => (
                  <Typography.Text strong={index === 0}>{v.toFixed(4)}</Typography.Text>
                ),
              },
              { title: "lr", dataIndex: "learningRate", width: 90, render: (v: unknown) => String(v ?? "—") },
              { title: "epochs", dataIndex: "epochs", width: 80, render: (v: unknown) => String(v ?? "—") },
              { title: "rank", dataIndex: "loraRank", width: 70, render: (v: unknown) => String(v ?? "—") },
              { title: "cutoff", dataIndex: "cutoffLen", width: 80, render: (v: unknown) => String(v ?? "—") },
              { title: "exact", dataIndex: "exactMatch", width: 80, render: (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`) },
              { title: "复述", dataIndex: "copyInput", width: 80, render: (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`) },
              { title: "条数", dataIndex: "nPred", width: 60 },
            ]}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="评估后点「开始调参」并勾选保存，才会出现对比。" />
        )}
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
