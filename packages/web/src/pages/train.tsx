/** 写出训练配置并启动。环境安装在右下角，本页只填执行目录和训练设置。 */
import { Alert, Button, Card, Col, Form, Input, InputNumber, Radio, Row, Select, Space } from "antd";
import { App as AntdApp } from "antd";
import { useEffect, useState } from "react";
import { useJob } from "../jobs/JobContext";
import { ConfirmDangerButton } from "../ui/ConfirmDangerButton";
import { LogCard } from "../ui/LogCard";
import { PageHeader } from "../ui/PageHeader";
import { PipelineStrip } from "../ui/PipelineStrip";

export const menu = { title: "训练", icon: "PlayCircleOutlined", order: 20 };

interface TrainForm {
  lfHome: string;
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

export default function TrainPage() {
  const { message } = AntdApp.useApp();
  const { job, start, cancel, isBusy } = useJob("train");
  const [form] = Form.useForm<TrainForm>();
  const [yaml, setYaml] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [reportRes, cfgRes] = await Promise.all([fetch("/api/reports"), fetch("/api/config")]);
      const reportBody = (await reportRes.json()) as {
        data?: { trainYaml?: string | null; trainKnobs?: Record<string, unknown> };
      };
      const cfgBody = (await cfgRes.json()) as { data?: Record<string, unknown> };
      setYaml(reportBody.data?.trainYaml ?? null);
      const knobs = reportBody.data?.trainKnobs ?? {};
      const model = String(knobs.model_name_or_path ?? "Qwen/Qwen3-0.6B");
      const lf = (cfgBody.data?.llamafactory ?? {}) as {
        home?: string;
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
        modelKind: local ? "local" : "online",
        hub,
        hfEndpoint: lf.hfEndpoint ?? "",
        model_name_or_path: model,
        template: String(knobs.template ?? "qwen3"),
        lora_rank: Number(knobs.lora_rank ?? 8),
        learning_rate: String(knobs.learning_rate ?? "1.0e-4"),
        num_train_epochs: Number(knobs.num_train_epochs ?? 2),
        per_device_train_batch_size: Number(knobs.per_device_train_batch_size ?? 1),
        cutoff_len: Number(knobs.cutoff_len ?? 256),
      });
    })();
  }, [form, job.busy]);

  async function run(): Promise<void> {
    const values = form.getFieldsValue(true);
    const model = String(values.model_name_or_path ?? "").trim();
    if (!model) {
      message.warning("请填写要用的底模（本机文件夹或网上的模型名）");
      return;
    }
    try {
      await start("/api/jobs/train", {
        home: String(values.lfHome ?? "").trim(),
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
        description="用训练集微调底模。结果保存在 outputs/train。训完后去评估页看纠错分数。"
      />
      <PipelineStrip />
      {job.error && !job.busy ? <Alert type="error" showIcon message={job.error} /> : null}
      <Form form={form} layout="vertical" initialValues={{ modelKind: "online", hub: "modelscope", hfEndpoint: "" }}>
        <Card title="LlamaFactory 目录" extra="还没装？点右下角扳手安装一次即可。">
          <Form.Item
            name="lfHome"
            label="执行目录"
            extra="装好 LlamaFactory 的那个文件夹。不是模型权重目录。请粘贴或输入完整路径。"
          >
            <Input placeholder="例如 E:\llama\LlamaFactory" />
          </Form.Item>
        </Card>
        <Card title="超参" extra={yaml ? <span>将写入 {yaml}</span> : null}>
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
                      <Form.Item name="hub" label="线上模型源" extra="国内默认 ModelScope。" hidden={local}>
                        <Select
                          options={[
                            { value: "modelscope", label: "魔搭 ModelScope" },
                            { value: "huggingface", label: "Hugging Face" },
                            { value: "openmind", label: "魔乐 Modelers" },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={14}>
                      <Form.Item
                        name="hfEndpoint"
                        label="Hugging Face 镜像（可空）"
                        extra="仅 Hugging Face 需要。国内可填 https://hf-mirror.com"
                        hidden={local}
                      >
                        <Input placeholder="可留空" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item
                    name="model_name_or_path"
                    label={local ? "本地模型路径" : "仓库 ID"}
                    extra={local ? "填写含 config.json 的权重目录" : "例如 Qwen/Qwen3-0.6B"}
                  >
                    {local ? <Input placeholder="例如 E:\models\Qwen2.5-0.5B-Instruct" /> : <Input placeholder="Qwen/Qwen3-0.6B" />}
                  </Form.Item>
                </>
              );
            }}
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="template" label="对话模板 template" extra="Qwen 系列一般填 qwen3。">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="lora_rank" label="LoRA rank" extra="越大越能记住，也越占显存。常用 8～16。">
                <InputNumber min={1} max={256} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="learning_rate" label="学习率" extra="过大容易学坏。">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="num_train_epochs" label="训练轮数">
                <InputNumber min={0.1} step={0.1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="per_device_train_batch_size" label="每卡 batch" extra="显存不够就填 1。">
                <InputNumber min={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="cutoff_len" label="截断长度 cutoff_len" extra="超过该长度的句子会被截断。">
                <InputNumber min={128} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Space>
            <Button type="primary" htmlType="button" disabled={isBusy("train")} onClick={() => void run()}>
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
