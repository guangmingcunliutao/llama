/** 写出 LlamaFactory yaml 并启动训练。启动前检测本机环境。 */
import { Alert, Button, Card, Col, Form, Input, InputNumber, Radio, Row, Select, Space, Typography } from "antd";
import { App as AntdApp } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useJob } from "../jobs/JobContext";
import { ConfirmDangerButton } from "../ui/ConfirmDangerButton";
import { LocalDirPicker } from "../ui/LocalDirPicker";
import { LogCard } from "../ui/LogCard";
import { PageHeader } from "../ui/PageHeader";

export const menu = { title: "训练", icon: "PlayCircleOutlined", order: 20 };

interface TrainForm {
  lfHome: string;
  lfBin: string;
  torchCuda: string;
  pipIndexUrl: string;
  modelKind: "local" | "online";
  hub: "huggingface" | "modelscope" | "openmind";
  hfEndpoint: string;
  model_name_or_path: string;
  template: string;
  lora_rank: number;
  learning_rate: string;
  num_train_epochs: number;
  per_device_train_batch_size: number;
  cutoff_len: number;
}

interface EnvDetect {
  ok: boolean;
  home: string | null;
  python: string | null;
  bin: string | null;
  mode: "module" | "cli" | null;
  errors: string[];
  notes: string[];
}

export default function TrainPage() {
  const { message } = AntdApp.useApp();
  const { job, start, cancel, isBusy } = useJob(["train", "lf-install"]);
  const [form] = Form.useForm<TrainForm>();
  const [yaml, setYaml] = useState<string | null>(null);
  const [env, setEnv] = useState<EnvDetect | null>(null);
  const [checking, setChecking] = useState(false);

  const probe = useCallback(async (): Promise<EnvDetect | null> => {
    const home = String(form.getFieldValue("lfHome") ?? "").trim();
    const bin = String(form.getFieldValue("lfBin") ?? "").trim();
    const params = new URLSearchParams();
    if (home) params.set("home", home);
    if (bin) params.set("bin", bin);
    setChecking(true);
    try {
      const qs = params.toString();
      const res = await fetch(`/api/train/env${qs ? `?${qs}` : ""}`);
      const body = (await res.json()) as { data?: EnvDetect; error?: string };
      const next = body.data ?? {
        ok: false,
        home: null,
        python: null,
        bin: null,
        mode: null,
        errors: [body.error ?? "环境检测失败"],
        notes: [],
      };
      setEnv(next);
      return next;
    } finally {
      setChecking(false);
    }
  }, [form]);

  useEffect(() => {
    void (async () => {
      const [reportRes, cfgRes] = await Promise.all([fetch("/api/reports"), fetch("/api/config")]);
      const reportBody = (await reportRes.json()) as {
        data?: { trainYaml?: string | null; trainKnobs?: Record<string, unknown> };
      };
      const cfgBody = (await cfgRes.json()) as { data?: Record<string, unknown> };
      setYaml(reportBody.data?.trainYaml ?? null);
      const knobs = reportBody.data?.trainKnobs ?? {};
      const model = String(knobs.model_name_or_path ?? "Qwen/Qwen2.5-0.5B-Instruct");
      const lf = (cfgBody.data?.llamafactory ?? {}) as {
        home?: string;
        bin?: string;
        hub?: string;
        hfEndpoint?: string;
      };
      const pathLooksLocal =
        /^[A-Za-z]:[\\/]/.test(model) ||
        model.startsWith("/") ||
        model.startsWith("\\\\") ||
        model.startsWith("~");
      const local = lf.hub === "local" || pathLooksLocal;
      const hub =
        lf.hub === "huggingface" || lf.hub === "openmind" || lf.hub === "modelscope" ? lf.hub : "modelscope";
      form.setFieldsValue({
        lfHome: lf.home ?? "",
        lfBin: lf.bin ?? "",
        torchCuda: "auto",
        pipIndexUrl: "https://mirrors.aliyun.com/pypi/simple",
        modelKind: local ? "local" : "online",
        hub,
        hfEndpoint: lf.hfEndpoint ?? "",
        model_name_or_path: model,
        template: String(knobs.template ?? "qwen"),
        lora_rank: Number(knobs.lora_rank ?? 8),
        learning_rate: String(knobs.learning_rate ?? "1.0e-4"),
        num_train_epochs: Number(knobs.num_train_epochs ?? 2),
        per_device_train_batch_size: Number(knobs.per_device_train_batch_size ?? 1),
        cutoff_len: Number(knobs.cutoff_len ?? 1024),
      });
      window.setTimeout(() => {
        void probe();
      }, 0);
    })();
  }, [form, probe]);

  async function run(): Promise<void> {
    const values = form.getFieldsValue(true);
    const model = String(values.model_name_or_path ?? "").trim();
    if (!model) {
      message.warning("请填写基座模型（本地目录或线上仓库 ID）");
      return;
    }
    try {
      await start("/api/jobs/train", {
        home: String(values.lfHome ?? "").trim(),
        bin: String(values.lfBin ?? "").trim(),
        hub: values.modelKind === "local" ? "local" : (values.hub ?? "modelscope"),
        hfEndpoint: String(values.hfEndpoint ?? "").trim(),
        knobs: {
          model_name_or_path: model,
          template: values.template,
          lora_rank: values.lora_rank,
          learning_rate: values.learning_rate,
          num_train_epochs: values.num_train_epochs,
          per_device_train_batch_size: values.per_device_train_batch_size,
          cutoff_len: values.cutoff_len,
        },
      });
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <PageHeader
        title="训练"
        description="检测 LlamaFactory 环境后写出 yaml 并启动训练。请先在数据生成页得到训练集。"
      />
      {job.error && !job.busy ? <Alert type="error" showIcon message={job.error} /> : null}
      <Form form={form} layout="vertical" initialValues={{ modelKind: "online", hub: "modelscope", hfEndpoint: "" }}>
      <Card title="LlamaFactory 环境">
          <Form.Item
            name="lfHome"
            label="LlamaFactory 目录"
            extra="一键安装后是仓库下的 LlamaFactory。也可填含 .venv / finetune 的安装根。"
          >
            <Input placeholder="例如 D:\LLaMA-Factory" />
          </Form.Item>
          <Form.Item name="lfBin" label="llamafactory-cli（可选）" extra="一般留空，由目录下或旁边的 finetune 虚拟环境定位。">
            <Input placeholder="例如 E:\llama\finetune\Scripts\llamafactory-cli.exe" />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="torchCuda" label="PyTorch">
                <Select
                  options={[
                    { value: "auto", label: "GPU cu126（脚本默认）" },
                    { value: "cu124", label: "GPU cu124" },
                    { value: "cpu", label: "CPU" },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={16}>
              <Form.Item name="pipIndexUrl" label="PyPI 镜像">
                <Input />
              </Form.Item>
            </Col>
          </Row>
        <Space>
          <Button htmlType="button" loading={checking} onClick={() => void probe()}>
            检测环境
          </Button>
        </Space>
        {env ? (
          <Alert
            style={{ marginTop: 12 }}
            type={env.ok ? "success" : "error"}
            showIcon
            message={env.ok ? "环境可用" : "环境未就绪"}
            description={
              <Typography.Paragraph style={{ marginBottom: 0 }}>
                {env.python ? <div>Python：{env.python}</div> : null}
                {env.bin ? <div>CLI：{env.bin}</div> : null}
                {env.mode ? (
                  <div>启动方式：{env.mode === "module" ? "python -m llamafactory.cli" : "llamafactory-cli"}</div>
                ) : null}
                {env.notes.map((line) => (
                  <div key={line}>{line}</div>
                ))}
                {env.errors.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </Typography.Paragraph>
            }
          />
        ) : null}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 8 }}>
          一键安装执行包内脚本 packages/core/scripts/install-llamafactory.sh（uv、先装 PyTorch）。产物在数据仓库根的
          LlamaFactory/ 与 finetune/，不会写进包目录。需要 Git Bash 或 WSL。也可按
          <Typography.Link href="https://llamafactory.readthedocs.io/en/latest/getting_started/installation.html" target="_blank">
            官方说明
          </Typography.Link>
          手动装好后把目录填在上面。
        </Typography.Paragraph>
        <Space>
          <Button
            htmlType="button"
            disabled={isBusy("lf-install") || checking}
            onClick={() =>
              void (async () => {
                const values = form.getFieldsValue();
                await start("/api/jobs/lf-install", {
                  home: String(values.lfHome ?? "").trim(),
                  torchCuda: values.torchCuda,
                  pipIndexUrl: values.pipIndexUrl,
                });
                await probe();
              })()
            }
          >
            运行安装脚本
          </Button>
        </Space>
      </Card>
      <Card title="超参" extra={yaml ? <span>配置：{yaml}</span> : null}>
        <Form.Item name="modelKind" label="基座模型来源" extra="本地填已下载的权重目录；线上按仓库 ID 拉取。">
          <Radio.Group
            optionType="button"
            options={[
              { value: "local", label: "本地目录" },
              { value: "online", label: "线上仓库" },
            ]}
          />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, next) => prev.modelKind !== next.modelKind}>
          {() => {
            const local = form.getFieldValue("modelKind") === "local";
            return (
              <>
                <Row gutter={16}>
                  <Col xs={24} md={10}>
                    <Form.Item name="hub" label="线上模型源" extra="国内默认 ModelScope，无需翻墙。" hidden={local}>
                      <Select
                        options={[
                          { value: "modelscope", label: "ModelScope 魔搭" },
                          { value: "huggingface", label: "Hugging Face" },
                          { value: "openmind", label: "魔乐 Modelers" },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={14}>
                    <Form.Item
                      name="hfEndpoint"
                      label="Hugging Face 镜像（可选）"
                      extra="仅 Hugging Face 需要。国内可填 https://hf-mirror.com"
                      hidden={local}
                    >
                      <Input placeholder="可留空，或 https://hf-mirror.com" />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item
                  name="model_name_or_path"
                  label={local ? "本地模型路径" : "仓库 ID"}
                  extra={local ? undefined : "例如 Qwen/Qwen2.5-0.5B-Instruct"}
                >
                  {local ? <LocalDirPicker /> : <Input placeholder="Qwen/Qwen2.5-0.5B-Instruct" />}
                </Form.Item>
              </>
            );
          }}
        </Form.Item>
        <Row gutter={16}>
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
        <Space>
          <Button
            type="primary"
            htmlType="button"
            disabled={isBusy("train") || !env?.ok}
            onClick={() => void run()}
          >
            开始训练
          </Button>
          <ConfirmDangerButton disabled={!job.busy} onConfirm={cancel} />
        </Space>
      </Card>
      </Form>
      <LogCard lines={job.logs} busy={job.busy} jobName={job.job} onStop={cancel} />
    </>
  );
}
