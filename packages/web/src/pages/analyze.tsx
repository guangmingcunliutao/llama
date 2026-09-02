/** 读取评估/验证预测目录，给出下一轮超参建议。不重新跑模型。 */
import { Alert, Button, Card, Checkbox, Empty, Form, Input, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useJob } from "../jobs/JobContext";
import { ConfirmDangerButton } from "../ui/ConfirmDangerButton";
import { LogCard } from "../ui/LogCard";
import { PageHeader } from "../ui/PageHeader";
import { PipelineStrip } from "../ui/PipelineStrip";

export const menu = { title: "调参", icon: "BarChartOutlined", order: 40 };

export default function AnalyzePage() {
  const navigate = useNavigate();
  const { job, start, cancel } = useJob("analyze");
  const [form] = Form.useForm();
  const [markdown, setMarkdown] = useState("");

  useEffect(() => {
    void fetch("/api/config")
      .then((res) => res.json())
      .then((body: { data?: { train?: { config?: string } } }) => {
        form.setFieldsValue({
          dir: "./outputs/lf-predict",
          trainConfig: body.data?.train?.config ?? "./outputs/llamafactory/train_sft.yaml",
          name: "",
          note: "",
          save: true,
          compare: true,
        });
      });
    void fetch("/api/reports")
      .then((res) => res.json())
      .then((body: { data?: { analysis?: string | null; compare?: string | null } }) => {
        setMarkdown(body.data?.analysis || body.data?.compare || "");
      });
  }, [form, job.busy]);

  async function run(): Promise<void> {
    const values = await form.validateFields();
    await start("/api/jobs/analyze", values);
  }

  return (
    <>
      <PageHeader
        title="调参"
        description="不加载模型。读取评估留下的预测，给出下一轮超参建议。请先完成评估。"
      />
      <PipelineStrip />
      {job.error && !job.busy ? <Alert type="error" showIcon message={job.error} /> : null}
      <Card title="预测">
        <Typography.Paragraph type="secondary">
          默认是评估刚写出的 outputs/lf-predict。不要填 outputs/train（那是训练结果，里面没有预测文件）。
        </Typography.Paragraph>
        <Form form={form} layout="vertical">
          <Form.Item
            name="dir"
            label="预测输出目录"
            rules={[{ required: true }]}
            extra="评估完成后才会有。也可填 LlamaFactory 自己的预测目录。"
          >
            <Input placeholder="./outputs/lf-predict" />
          </Form.Item>
          <Form.Item name="trainConfig" label="本轮训练 yaml">
            <Input />
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
          <Button type="primary" htmlType="button" disabled={job.busy} onClick={() => void run()}>
            开始调参
          </Button>
          <Button htmlType="button" onClick={() => navigate("/eval")}>
            返回评估
          </Button>
          <ConfirmDangerButton disabled={!job.busy} onConfirm={cancel} />
        </Space>
      </Card>
      <Card title="调参报告">
        {markdown ? (
          <pre className="report-pre">{markdown}</pre>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有报告。请先评估，再对本页默认文件夹点「开始调参」。"
          />
        )}
      </Card>
      <LogCard lines={job.logs} busy={job.busy} jobName={job.job} onStop={cancel} />
    </>
  );
}
