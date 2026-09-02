/** 用本机 llama.cpp 的 llama-quantize 导出 GGUF。 */
import { Alert, Button, Card, Checkbox, Col, Form, Input, Row, Select, Space, Typography } from "antd";
import { App as AntdApp } from "antd";
import { useEffect, useState } from "react";
import { useJob } from "../jobs/JobContext";
import { ConfirmDangerButton } from "../ui/ConfirmDangerButton";
import { LogCard } from "../ui/LogCard";
import { PageHeader } from "../ui/PageHeader";
import { PipelineStrip } from "../ui/PipelineStrip";

export const menu = { title: "量化导出", icon: "ThunderboltOutlined", order: 50 };

const PRESETS = ["Q4_K_M", "Q5_K_M", "Q8_0", "Q6_K", "IQ4_XS", "Q3_K_M"];

interface QuantEnv {
  ok?: boolean;
  quantize?: string | null;
  convert?: string | null;
  python?: string | null;
  notes?: string[];
  llamaHome?: string | null;
  convertScript?: string | null;
}

export default function QuantPage() {
  const { message } = AntdApp.useApp();
  const { job, start, cancel } = useJob("quant");
  const [form] = Form.useForm();
  const [detect, setDetect] = useState("输入本地 GGUF 或已合并的 HuggingFace 模型目录后点击检测。");
  const [env, setEnv] = useState<QuantEnv | null>(null);
  const locked = job.busy;

  useEffect(() => {
    void fetch("/api/quant/env")
      .then((res) => res.json())
      .then((body: { data?: QuantEnv }) => {
        const next = body.data ?? {};
        setEnv(next);
        const patch: Record<string, string> = {};
        if (!String(form.getFieldValue("llamaHome") ?? "").trim() && next.llamaHome) {
          patch.llamaHome = next.llamaHome;
        }
        if (!String(form.getFieldValue("convertScript") ?? "").trim() && (next.convertScript || next.convert)) {
          patch.convertScript = next.convertScript || next.convert || "";
        }
        if (Object.keys(patch).length) form.setFieldsValue(patch);
      });
  }, [form, locked]);

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
      ? `已识别：${info.kind === "gguf" ? "GGUF 文件" : info.kind === "hf-dir" ? "模型目录" : "普通文件"}`
      : "路径不存在，请检查盘符与权限";
    setDetect(text);
  }

  async function run(): Promise<void> {
    const values = await form.validateFields();
    const home = String(values.llamaHome ?? "").trim();
    if (!env?.quantize && !home) {
      message.warning("请填写 llama.cpp 工具目录（含 llama-quantize 的运行包、Llama.app 或源码目录）");
      return;
    }
    await start("/api/jobs/quant", {
      source: values.source,
      formats: values.formats,
      custom: values.custom,
      dtype: values.dtype,
      requant: values.requant === true,
      keepMid: values.keepMid === true,
      llamaHome: home,
      convertScript: values.convertScript,
    });
  }

  return (
    <>
      <PageHeader
        title="量化导出"
        description="用本机 llama.cpp 把模型转成 GGUF。换电脑时拷贝工具目录并在设置里填写即可。LoRA 目录不能直接量化。"
      />
      <PipelineStrip />
      {job.error && !job.busy ? <Alert type="error" showIcon message={job.error} /> : null}
      <Alert
        type={env?.ok ? "success" : "info"}
        showIcon
        style={{ marginBottom: 16 }}
        message={
          env?.ok
            ? `将使用 ${env.quantize}${env.convert ? `；HF 转换：${env.convert}` : "（当前只能量化已有 GGUF，HF 目录还需 convert_hf_to_gguf.py）"}`
            : "把官方运行包、Llama.app 或 llama.cpp 编译目录拷到本机，填写该目录。量化用 llama-quantize，不是聊天用的 llama.exe。"
        }
      />
      <Form
        form={form}
        layout="vertical"
        disabled={locked}
        initialValues={{ formats: ["Q4_K_M"], custom: "", dtype: "f16", requant: false, keepMid: false }}
      >
        <Card title="工具">
          <Form.Item
            name="llamaHome"
            label="llama.cpp 工具目录"
            extra="可填运行包目录、Llama.app，或含 llama-quantize 的编译目录。换机只需拷这个目录并改路径。"
          >
            <Input placeholder="例如 D:\tools\llama.cpp 或 Llama.app" />
          </Form.Item>
          <Form.Item
            name="convertScript"
            label="convert_hf_to_gguf.py（可选）"
            extra="仅当源是 HuggingFace 目录时需要。官方 Windows zip 通常没有该脚本；可把 llama.cpp 源码放在工具目录旁边自动发现。"
          >
            <Input placeholder="可留空；HF 目录量化时再填" />
          </Form.Item>
        </Card>
        <Card title="① 源模型">
          <Form.Item name="source" label="本地路径" rules={[{ required: true, message: "填写 GGUF 或含 config.json 的合并模型目录" }]}>
            <Input placeholder="xxx.gguf 或已 merge 的模型文件夹" />
          </Form.Item>
          <Space>
            <Button htmlType="button" onClick={() => void onDetect()}>
              检测
            </Button>
            <Typography.Text type="secondary">{detect}</Typography.Text>
          </Space>
        </Card>
        <Card title="② 目标格式">
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
      <Card style={{ marginTop: 16 }}>
        <Space>
          <Button type="primary" htmlType="button" disabled={locked} onClick={() => void run()}>
            开始量化
          </Button>
          <ConfirmDangerButton disabled={!locked} onConfirm={() => cancel("quant")} />
        </Space>
      </Card>
      <LogCard lines={job.logs} busy={job.busy} jobName={job.job} onStop={() => cancel("quant")} />
    </>
  );
}
