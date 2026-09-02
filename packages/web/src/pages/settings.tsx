/** 读写仓库根的 model-training.config.json。 */
import { Button, Card, Form, Input, Select, Space } from "antd";
import { App as AntdApp } from "antd";
import { useEffect } from "react";
import { PageHeader } from "../ui/PageHeader";

export const menu = { title: "设置", icon: "SettingOutlined", order: 90 };

export default function SettingsPage() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();

  useEffect(() => {
    void fetch("/api/config")
      .then((res) => res.json())
      .then((body: { data?: Record<string, unknown> }) => {
        const cfg = body.data ?? {};
        const infer = (cfg.infer ?? {}) as { backend?: string; http?: { url?: string; model?: string } };
        form.setFieldsValue({
          outDir: cfg.outDir ?? "./outputs",
          dict: cfg.dict ?? "./data/term_pairs.jsonl",
          cacheDir: cfg.cacheDir ?? "./cache",
          instruction: cfg.instruction ?? "",
          inferBackend: infer.backend && infer.backend !== "rule" ? infer.backend : "llamafactory",
          inferUrl: infer.http?.url ?? "",
          inferModel: infer.http?.model ?? "",
          lfHome: (cfg.llamafactory as { home?: string } | undefined)?.home ?? "",
          lfBin: (cfg.llamafactory as { bin?: string } | undefined)?.bin ?? "",
          lfHub: (cfg.llamafactory as { hub?: string } | undefined)?.hub ?? "modelscope",
          hfEndpoint: (cfg.llamafactory as { hfEndpoint?: string } | undefined)?.hfEndpoint ?? "",
        });
      });
  }, [form]);

  async function save(): Promise<void> {
    const values = await form.validateFields();
    const current = await fetch("/api/config").then((res) => res.json()) as { data?: Record<string, unknown> };
    const next = {
      ...(current.data ?? {}),
      outDir: values.outDir,
      dict: values.dict,
      cacheDir: values.cacheDir,
      instruction: values.instruction,
      infer: {
        backend: values.inferBackend,
        http: { url: values.inferUrl, model: values.inferModel },
      },
      llamafactory: {
        ...((current.data?.llamafactory as object) ?? {}),
        home: values.lfHome,
        bin: values.lfBin,
        hub: values.lfHub,
        hfEndpoint: values.hfEndpoint,
      },
    };
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      message.error("保存失败");
      return;
    }
    message.success("已写入 model-training.config.json");
  }

  return (
    <>
      <PageHeader title="设置" description="这里改的是和命令行共用的那份配置文件。一般不用天天动。" />
      <Card>
        <Form form={form} layout="vertical">
          <Form.Item name="outDir" label="产物目录 outDir">
            <Input />
          </Form.Item>
          <Form.Item name="dict" label="字典 dict">
            <Input />
          </Form.Item>
          <Form.Item name="cacheDir" label="检索缓存 cacheDir">
            <Input />
          </Form.Item>
          <Form.Item name="instruction" label="默认系统提示词">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="inferBackend" label="默认推理后端" extra="评估页主按钮固定用训练模型；规则基线仅作对照。">
            <Select
              options={[
                { value: "llamafactory", label: "LlamaFactory（训练模型）" },
                { value: "http", label: "HTTP（OpenAI 兼容）" },
                { value: "file", label: "只导出样本" },
                { value: "rule", label: "规则对照（不加载模型）" },
              ]}
            />
          </Form.Item>
          <Form.Item name="inferUrl" label="推理 URL">
            <Input />
          </Form.Item>
          <Form.Item name="inferModel" label="推理模型名">
            <Input />
          </Form.Item>
          <Form.Item name="lfHome" label="LlamaFactory 目录" extra="含 src/llamafactory 或 .venv 的安装根。训练/评估产物按实验写在 outDir 下，不必再填 yaml 路径。">
            <Input placeholder="例如 D:\LLaMA-Factory" />
          </Form.Item>
          <Form.Item name="lfBin" label="llamafactory-cli（可选）">
            <Input />
          </Form.Item>
          <Form.Item name="lfHub" label="默认线上模型源">
            <Select
              options={[
                { value: "modelscope", label: "ModelScope 魔搭" },
                { value: "huggingface", label: "Hugging Face" },
                { value: "openmind", label: "魔乐 Modelers" },
                { value: "local", label: "本地目录" },
              ]}
            />
          </Form.Item>
          <Form.Item name="hfEndpoint" label="Hugging Face 镜像" extra="仅 hub 为 Hugging Face 时使用，例如 https://hf-mirror.com">
            <Input />
          </Form.Item>
        </Form>
        <Space>
          <Button type="primary" onClick={() => void save()}>
            保存配置
          </Button>
        </Space>
      </Card>
    </>
  );
}
