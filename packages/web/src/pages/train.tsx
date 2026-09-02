/** 写出训练配置并启动。每次训练是一次实验，写在 outputs/train/<id>。 */
import { Alert, Button, Card, Col, Form, Input, InputNumber, Popconfirm, Radio, Row, Select, Space, Table, Tag } from "antd";
import { App as AntdApp } from "antd";
import { useEffect, useState } from "react";
import { useJob } from "../jobs/JobContext";
import { useRuns } from "../runs/useRuns";
import type { RunSummary } from "../runs/types";
import { ConfirmDangerButton } from "../ui/ConfirmDangerButton";
import { LogCard } from "../ui/LogCard";
import { PageHeader } from "../ui/PageHeader";
import { PipelineStrip } from "../ui/PipelineStrip";

export const menu = { title: "训练", icon: "PlayCircleOutlined", order: 20 };

interface TrainForm {
  mode: "fresh" | "resume" | "continue";
  label: string;
  dataRunId: string;
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

const STATUS_COLOR: Record<string, string> = {
  running: "processing",
  completed: "success",
  interrupted: "warning",
  failed: "error",
  pending: "default",
};

export default function TrainPage() {
  const { message } = AntdApp.useApp();
  const { job, start, cancel, isBusy } = useJob("train");
  const trainRuns = useRuns("train");
  const dataRuns = useRuns("data");
  const [form] = Form.useForm<TrainForm>();
  const [dataOptions, setDataOptions] = useState<RunSummary[]>([]);

  useEffect(() => {
    void (async () => {
      const [reportRes, cfgRes, dataRes] = await Promise.all([
        fetch("/api/reports"),
        fetch("/api/config"),
        fetch("/api/runs?kind=data"),
      ]);
      const reportBody = (await reportRes.json()) as {
        data?: { trainYaml?: string | null; trainKnobs?: Record<string, unknown> };
      };
      const cfgBody = (await cfgRes.json()) as { data?: Record<string, unknown> };
      const dataBody = (await dataRes.json()) as { data?: { runs?: RunSummary[]; workspace?: { dataRunId?: string | null } } };
      setDataOptions(dataBody.data?.runs ?? []);
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
        mode: trainRuns.selected?.canResume ? "resume" : "fresh",
        label: "",
        dataRunId: dataBody.data?.workspace?.dataRunId ?? "",
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
  }, [form, job.busy, trainRuns.selected?.canResume]);

  useEffect(() => {
    if (!job.busy) void trainRuns.refresh();
  }, [job.busy, trainRuns.refresh]);

  async function run(): Promise<void> {
    const values = form.getFieldsValue(true);
    const model = String(values.model_name_or_path ?? "").trim();
    if (!model) {
      message.warning("请填写要用的底模（本机文件夹或网上的模型名）");
      return;
    }
    try {
      await start("/api/jobs/train", {
        mode: values.mode,
        label: values.label || undefined,
        runId: values.mode === "resume" ? trainRuns.selectedId : undefined,
        parentId: values.mode === "continue" ? trainRuns.selectedId : undefined,
        dataRunId: values.dataRunId || undefined,
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
        description="每次训练写入 outputs/train 下的独立实验。可从 checkpoint 续训，或基于上一份 LoRA 再训。"
      />
      <PipelineStrip />
      {job.error && !job.busy ? <Alert type="error" showIcon message={job.error} /> : null}

      <Card title="训练实验" extra={trainRuns.selected?.resumeHint}>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={trainRuns.rows}
          onRow={(row) => ({ onClick: () => void trainRuns.select(row.id) })}
          rowClassName={(row) => (row.id === trainRuns.selectedId ? "ant-table-row-selected" : "")}
          columns={[
            { title: "实验", dataIndex: "label", ellipsis: true },
            {
              title: "状态",
              dataIndex: "status",
              width: 110,
              render: (status: string) => <Tag color={STATUS_COLOR[status] ?? "default"}>{status}</Tag>,
            },
            { title: "checkpoint", dataIndex: "lastCheckpoint", width: 140, render: (v: string | null) => v ?? "—" },
            {
              title: "adapter",
              dataIndex: "adapterReady",
              width: 90,
              render: (v: boolean) => (v ? "有" : "无"),
            },
            {
              title: "",
              width: 70,
              render: (_, row) => (
                <Popconfirm title="删除该训练实验？" onConfirm={() => void trainRuns.remove(row.id)}>
                  <Button type="link" danger size="small" onClick={(e) => e.stopPropagation()}>
                    删除
                  </Button>
                </Popconfirm>
              ),
            },
          ]}
        />
      </Card>

      <Form form={form} layout="vertical" initialValues={{ modelKind: "online", hub: "modelscope", hfEndpoint: "", mode: "fresh" }}>
        <Card title="LlamaFactory 目录" extra="还没装？点右下角扳手安装一次即可。">
          <Form.Item name="lfHome" label="执行目录" extra="装好 LlamaFactory 的那个文件夹。请粘贴完整路径。">
            <Input placeholder="例如 E:\llama\LlamaFactory" />
          </Form.Item>
        </Card>
        <Card title="超参">
          <Form.Item name="mode" label="方式">
            <Radio.Group
              optionType="button"
              options={[
                { value: "fresh", label: "全新训练" },
                { value: "resume", label: "继续未完成", disabled: !trainRuns.selected?.canResume },
                { value: "continue", label: "基于上次再训练", disabled: !trainRuns.selected?.adapterReady },
              ]}
            />
          </Form.Item>
          <Form.Item name="label" label="实验名称">
            <Input placeholder="例如 qwen06b-r8" />
          </Form.Item>
          <Form.Item name="dataRunId" label="训练集（数据实验）" extra="全新训练和再训练需要。">
            <Select
              allowClear
              options={(dataOptions.length ? dataOptions : dataRuns.rows).map((row) => ({
                value: row.id,
                label: `${row.label}（${row.trainRows ?? 0} 条）`,
              }))}
            />
          </Form.Item>
          <Form.Item name="modelKind" label="基座模型来源">
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
                      <Form.Item name="hub" label="线上模型源" hidden={local}>
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
                      <Form.Item name="hfEndpoint" label="Hugging Face 镜像（可空）" hidden={local}>
                        <Input placeholder="可留空" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name="model_name_or_path" label={local ? "本地模型路径" : "仓库 ID"}>
                    {local ? <Input placeholder="例如 E:\models\Qwen2.5-0.5B-Instruct" /> : <Input placeholder="Qwen/Qwen3-0.6B" />}
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
            <Button type="primary" htmlType="button" disabled={isBusy("train")} onClick={() => void run()}>
              开始训练
            </Button>
            <ConfirmDangerButton
              disabled={!job.busy}
              onConfirm={cancel}
              description="会结束训练进程。已保存的 checkpoint 会留在当前实验里，可继续未完成训练。"
            />
          </Space>
        </Card>
      </Form>
      <LogCard lines={job.logs} busy={job.busy} jobName={job.job} onStop={cancel} />
    </>
  );
}
