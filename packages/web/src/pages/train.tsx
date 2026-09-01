/** 写出 LlamaFactory yaml 并启动 `llamafactory-cli train`。 */
import { Alert, Button, Card, Col, Form, Input, InputNumber, Row, Space } from "antd";
import { useEffect, useState } from "react";
import { useJob } from "../jobs/JobContext";
import { LogCard } from "../ui/LogCard";
import { PageHeader } from "../ui/PageHeader";

export const menu = { title: "训练", icon: "PlayCircleOutlined", order: 20 };

interface TrainForm {
  model_name_or_path: string;
  template: string;
  lora_rank: number;
  learning_rate: string;
  num_train_epochs: number;
  per_device_train_batch_size: number;
  cutoff_len: number;
}

export default function TrainPage() {
  const { job, start, cancel } = useJob();
  const [form] = Form.useForm<TrainForm>();
  const [yaml, setYaml] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/reports")
      .then((res) => res.json())
      .then((body: { data?: { trainYaml?: string | null; trainKnobs?: Record<string, unknown> } }) => {
        setYaml(body.data?.trainYaml ?? null);
        const knobs = body.data?.trainKnobs ?? {};
        form.setFieldsValue({
          model_name_or_path: String(knobs.model_name_or_path ?? "Qwen/Qwen2.5-0.5B-Instruct"),
          template: String(knobs.template ?? "qwen"),
          lora_rank: Number(knobs.lora_rank ?? 8),
          learning_rate: String(knobs.learning_rate ?? "1.0e-4"),
          num_train_epochs: Number(knobs.num_train_epochs ?? 2),
          per_device_train_batch_size: Number(knobs.per_device_train_batch_size ?? 1),
          cutoff_len: Number(knobs.cutoff_len ?? 1024),
        });
      });
  }, [form]);

  async function run(): Promise<void> {
    const values = await form.validateFields();
    await start("/api/jobs/train", {
      knobs: {
        model_name_or_path: values.model_name_or_path,
        template: values.template,
        lora_rank: values.lora_rank,
        learning_rate: values.learning_rate,
        num_train_epochs: values.num_train_epochs,
        per_device_train_batch_size: values.per_device_train_batch_size,
        cutoff_len: values.cutoff_len,
      },
    });
  }

  return (
    <>
      <PageHeader
        title="训练"
        description="写出 dataset_info.json 与训练 yaml，然后启动 llamafactory-cli train。请先在数据生成页得到训练集。"
      />
      {job.error && !job.busy ? (
        <Alert type="error" showIcon message={job.error} style={{ marginBottom: 16 }} />
      ) : null}
      <Card title="超参" style={{ marginBottom: 16 }} extra={yaml ? <span>配置：{yaml}</span> : null}>
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="model_name_or_path" label="基座模型 model_name_or_path" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="template" label="对话模板 template">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="lora_rank" label="LoRA rank">
                <InputNumber min={1} max={256} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="learning_rate" label="学习率">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="num_train_epochs" label="训练轮数">
                <InputNumber min={0.1} step={0.1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="per_device_train_batch_size" label="每卡 batch">
                <InputNumber min={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="cutoff_len" label="截断长度 cutoff_len">
                <InputNumber min={128} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
        <Space>
          <Button type="primary" disabled={job.busy} onClick={() => void run()}>
            开始训练
          </Button>
          <Button danger disabled={!job.busy} onClick={() => void cancel()}>
            停止
          </Button>
        </Space>
      </Card>
      <LogCard title={job.busy ? `运行中：${job.job}` : "训练日志"} lines={job.logs} />
    </>
  );
}
