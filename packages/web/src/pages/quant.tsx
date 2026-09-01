/** GGUF / HF 路径检测与量化格式选择。 */
import { Alert, Button, Card, Checkbox, Col, Form, Input, Row, Select, Space, Typography } from "antd";
import { App as AntdApp } from "antd";
import { useState } from "react";
import { PageHeader } from "../ui/PageHeader";

export const menu = { title: "量化导出", icon: "ThunderboltOutlined", order: 50 };

const PRESETS = ["Q4_K_M", "Q5_K_M", "Q8_0", "Q6_K", "IQ4_XS", "Q3_K_M"];

export default function QuantPage() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [detect, setDetect] = useState<string>("输入本地 GGUF 或 HuggingFace 模型目录后点击检测。");

  async function onDetect(): Promise<void> {
    const path = String(form.getFieldValue("source") ?? "").trim();
    if (!path) {
      message.warning("请先填写路径");
      return;
    }
    const res = await fetch(`/api/quant/detect?path=${encodeURIComponent(path)}`);
    const body = (await res.json()) as {
      ok: boolean;
      data?: { exists?: boolean; kind?: string };
      error?: string;
    };
    if (!body.ok) {
      message.error(body.error || "检测失败");
      return;
    }
    const info = body.data;
    const text = info?.exists
      ? `已识别：${info.kind === "gguf" ? "GGUF 文件" : info.kind === "hf-dir" ? "HF 模型目录" : "普通文件"}`
      : "路径不存在，请检查盘符与权限";
    setDetect(text);
  }

  return (
    <>
      <PageHeader
        title="量化导出"
        description="把本机 GGUF 或 HuggingFace 权重转成部署用量化格式。转换走系统里的 llama-quantize / 转换脚本，不把 llama.cpp 推进本仓库。"
      />
      <Form form={form} layout="vertical" initialValues={{ formats: ["Q4_K_M"], custom: "", dtype: "f16", requant: false, keepMid: false }}>
      <Card title="① 源模型" style={{ marginBottom: 16 }}>
          <Form.Item name="source" label="本地路径" rules={[{ required: true, message: "填写 GGUF 或含 config.json 的目录" }]}>
            <Input placeholder="D:/models/Qwen2.5-0.5B 或 xxx.gguf" />
          </Form.Item>
          <Space>
            <Button onClick={() => void onDetect()}>检测</Button>
            <Typography.Text type="secondary">{detect}</Typography.Text>
          </Space>
      </Card>
      <Card title="② 目标格式" style={{ marginBottom: 16 }}>
          <Form.Item name="formats" label="预置量化类型">
            <Checkbox.Group options={PRESETS.map((name) => ({ label: name, value: name }))} />
          </Form.Item>
          <Form.Item name="custom" label="自定义格式（逗号分隔）">
            <Input placeholder="如 IQ4_XS, Q3_K_L" />
          </Form.Item>
          <Form.Item name="dtype" label="HF 目录转换精度">
            <Select
              options={[
                { value: "f16", label: "f16（默认推荐）" },
                { value: "bf16", label: "bf16" },
                { value: "f32", label: "f32（不压缩，仅转换）" },
              ]}
            />
          </Form.Item>
          <Row gutter={16}>
            <Col>
              <Form.Item name="requant" valuePropName="checked">
                <Checkbox>允许对已量化 GGUF 再量化（损质量）</Checkbox>
              </Form.Item>
            </Col>
            <Col>
              <Form.Item name="keepMid" valuePropName="checked">
                <Checkbox>保留 HF 转换的中间 GGUF</Checkbox>
              </Form.Item>
            </Col>
          </Row>
      </Card>
      </Form>
      <Alert
        type="info"
        showIcon
        message="量化任务将调用本机 llama-quantize。请把可执行文件加入 PATH，或在设置里填写路径后再启动。"
        style={{ marginBottom: 16 }}
      />
      <Button type="primary" disabled>
        开始量化（环境检测通过后开放）
      </Button>
    </>
  );
}
