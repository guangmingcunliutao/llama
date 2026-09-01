/** 读取 LlamaFactory 验证目录，给出分析报告。 */
import { Alert, Button, Card, Checkbox, Empty, Form, Input, Space } from "antd";
import { useEffect, useState } from "react";
import { useJob } from "../jobs/JobContext";
import { LogCard } from "../ui/LogCard";
import { PageHeader } from "../ui/PageHeader";

export const menu = { title: "训练分析", icon: "BarChartOutlined", order: 40 };

export default function AnalyzePage() {
  const { job, start, cancel } = useJob();
  const [form] = Form.useForm();
  const [markdown, setMarkdown] = useState("");

  useEffect(() => {
    void fetch("/api/config")
      .then((res) => res.json())
      .then((body: { data?: { train?: { config?: string; outputDir?: string } } }) => {
        form.setFieldsValue({
          dir: body.data?.train?.outputDir ?? "./outputs/train",
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
        title="训练分析"
        description="读取 LlamaFactory 验证/预测目录（predict_results.json、generated_predictions.jsonl 等），给出超参建议，并可保存多轮对比。"
      />
      {job.error && !job.busy ? (
        <Alert type="error" showIcon message={job.error} style={{ marginBottom: 16 }} />
      ) : null}
      <Card title="分析参数" style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical">
          <Form.Item name="dir" label="LlamaFactory 输出目录" rules={[{ required: true }]}>
            <Input placeholder="含 predict_results.json 的目录" />
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
        <Space style={{ marginTop: 16 }}>
          <Button type="primary" disabled={job.busy} onClick={() => void run()}>
            开始分析
          </Button>
          <Button danger disabled={!job.busy} onClick={() => void cancel()}>
            停止
          </Button>
        </Space>
      </Card>
      <Card title="分析报告" style={{ marginBottom: 16 }}>
        {markdown ? (
          <pre className="log-pre">{markdown}</pre>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有分析报告。请先完成一轮训练并产生 LlamaFactory 验证目录，再填写路径后点「开始分析」。"
          />
        )}
      </Card>
      <LogCard title={job.busy ? `运行中：${job.job}` : "任务日志"} lines={job.logs} />
    </>
  );
}
