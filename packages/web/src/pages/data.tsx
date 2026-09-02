/**
 * 数据生成：上传种子、选择检索源、按实验写入 outputs/data/<id>。
 */
import { InboxOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Radio,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import type { UploadProps } from "antd";
import { App as AntdApp } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useJob } from "../jobs/JobContext";
import { useRuns } from "../runs/useRuns";
import { ConfirmDangerButton } from "../ui/ConfirmDangerButton";
import { LogCard } from "../ui/LogCard";
import { PageHeader } from "../ui/PageHeader";
import { PipelineStrip } from "../ui/PipelineStrip";

export const menu = { title: "数据生成", icon: "DatabaseOutlined", order: 10 };

interface FileStat {
  path: string | null;
  exists: boolean;
  rows: number;
}

interface DatasetStatus {
  dict: FileStat;
  train: FileStat;
  eval: FileStat;
}

interface SourceItem {
  name: string;
  type: string;
  title?: string;
  description?: string;
  enabled?: boolean;
}

interface GenForm {
  mode: "fresh" | "resume" | "continue";
  label: string;
  pairsPerTerm: number;
  maxWords: number | null;
  cleanRatioPct: number;
  maxPages: number;
  seed: number;
  minLen: number;
  maxLen: number;
  rpm: number;
  jitterSec: number;
  formats: string[];
  sources: string[];
  instruction: string;
}

const STATUS_COLOR: Record<string, string> = {
  running: "processing",
  completed: "success",
  interrupted: "warning",
  failed: "error",
  pending: "default",
};

export default function DataPage() {
  const { message } = AntdApp.useApp();
  const { job, start, cancel, isBusy } = useJob(["generate", "generate-eval"]);
  const runs = useRuns("data");
  const [stats, setStats] = useState<DatasetStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sourceOpts, setSourceOpts] = useState<SourceItem[]>([]);
  const [form] = Form.useForm<GenForm>();

  const loadStats = useCallback(async () => {
    const res = await fetch("/api/datasets");
    const body = (await res.json()) as { ok: boolean; data: DatasetStatus; error?: string };
    if (!res.ok) {
      message.error(body.error || "读取数据状态失败");
      return;
    }
    setStats(body.data);
  }, [message]);

  const loadConfig = useCallback(async () => {
    const [cfgRes, provRes] = await Promise.all([fetch("/api/config"), fetch("/api/providers")]);
    const body = (await cfgRes.json()) as { ok: boolean; data: Record<string, unknown> };
    const provBody = (await provRes.json()) as {
      ok: boolean;
      data?: { providers?: Array<{ id: string; name: string; description: string; enabled?: boolean }>; instruction?: string };
    };
    if (!cfgRes.ok) return;
    const cfg = body.data ?? {};
    const providers = provBody.data?.providers ?? [];
    const sources: SourceItem[] = providers.map((p) => ({
      name: p.id,
      type: "http",
      title: p.name,
      description: p.description,
      enabled: p.enabled,
    }));
    setSourceOpts(sources.length ? sources : Array.isArray(cfg.sources) ? (cfg.sources as SourceItem[]) : []);
    const rate = (cfg.rate ?? {}) as { requestsPerMinute?: number; jitterSec?: number };
    const sentence = (cfg.sentence ?? {}) as { minLen?: number; maxLen?: number };
    const formats = Array.isArray(cfg.formats)
      ? (cfg.formats as string[])
      : String(cfg.formats ?? "messages").split(/[,+\s]+/);
    const clean = Number(cfg.cleanRatio ?? 0.1);
    const selected = (sources.length ? sources : (cfg.sources as SourceItem[] | undefined) ?? []).filter(
      (s) => s.enabled !== false,
    );
    form.setFieldsValue({
      mode: "fresh",
      label: "",
      pairsPerTerm: Number(cfg.pairsPerTerm ?? 3),
      maxWords: cfg.limitTerms == null ? 20 : Number(cfg.limitTerms),
      cleanRatioPct: clean > 1 ? clean : Math.round(clean * 100),
      maxPages: Number(cfg.maxPages ?? 3),
      seed: Number((cfg.split as { seed?: number } | undefined)?.seed ?? 42),
      minLen: sentence.minLen ?? 16,
      maxLen: sentence.maxLen ?? 220,
      rpm: rate.requestsPerMinute ?? 5,
      jitterSec: rate.jitterSec ?? 2,
      formats: formats.filter(Boolean),
      sources: selected.map((s) => s.name),
      instruction: String(provBody.data?.instruction || cfg.instruction || ""),
    });
  }, [form]);

  useEffect(() => {
    void loadStats();
    void loadConfig();
  }, [loadStats, loadConfig]);

  useEffect(() => {
    if (!job.busy) {
      void loadStats();
      void runs.refresh();
    }
  }, [job.busy, loadStats, runs.refresh]);

  useEffect(() => {
    if (runs.selected?.canResume) form.setFieldValue("mode", "resume");
  }, [runs.selected?.canResume, form]);

  const uploadProps: UploadProps = {
    name: "file",
    multiple: false,
    showUploadList: true,
    maxCount: 1,
    accept: ".xlsx,.xls,.csv,.jsonl,.json",
    customRequest: async (options) => {
      const file = options.file as File;
      const formData = new FormData();
      formData.append("file", file);
      setUploading(true);
      try {
        const res = await fetch("/api/upload/seed", { method: "POST", body: formData });
        const body = (await res.json()) as { ok: boolean; error?: string; data?: DatasetStatus };
        if (!res.ok) {
          options.onError?.(new Error(body.error || "上传失败"));
          message.error(body.error || "上传失败");
          return;
        }
        if (body.data) setStats(body.data);
        options.onSuccess?.(body);
        message.success("种子已导入为词对字典");
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        options.onError?.(err as Error);
        message.error(text);
      } finally {
        setUploading(false);
      }
    },
  };

  async function generateBody() {
    const values = await form.validateFields();
    return {
      mode: values.mode,
      label: values.label || undefined,
      runId: values.mode === "resume" ? runs.selectedId : undefined,
      parentId: values.mode === "continue" ? runs.selectedId : undefined,
      pairsPerTerm: values.pairsPerTerm,
      limitTerms: values.maxWords && values.maxWords > 0 ? values.maxWords : 0,
      cleanRatio: values.cleanRatioPct,
      maxPages: values.maxPages,
      seed: values.seed,
      format: values.formats.join(","),
      sources: values.sources,
      instruction: values.instruction,
      sentence: { minLen: values.minLen, maxLen: values.maxLen },
      rate: { requestsPerMinute: values.rpm, jitterSec: values.jitterSec },
    };
  }

  async function runGenerate(): Promise<void> {
    await start("/api/jobs/generate", await generateBody());
  }

  async function runEvalGenerate(): Promise<void> {
    const values = await form.validateFields();
    await start("/api/jobs/generate-eval", {
      ...(await generateBody()),
      mode: values.mode === "fresh" ? "fresh" : "resume",
      runId: runs.selectedId,
    });
  }

  return (
    <>
      <PageHeader
        title="数据生成"
        description="每次生成是一次数据实验，写在 outputs/data 下。可以中断后续跑，也可以在上一份上追加。"
      />
      <PipelineStrip />

      <Row gutter={[12, 12]}>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="词对字典" value={stats?.dict.rows ?? 0} suffix="条" />
            <Typography.Text className="stat-path">
              {stats?.dict.exists ? stats.dict.path : "尚未导入种子"}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="当前训练集" value={runs.selected?.trainRows ?? 0} suffix="条" />
            <Typography.Text className="stat-path">{runs.selectedId ?? "未选实验"}</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="当前验证集" value={runs.selected?.evalRows ?? 0} suffix="条" />
            <Typography.Text className="stat-path">{runs.selected?.phase ?? "—"}</Typography.Text>
          </Card>
        </Col>
      </Row>

      <Card title="数据实验" extra={runs.selected?.resumeHint}>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={runs.rows}
          rowClassName={(row) => (row.id === runs.selectedId ? "ant-table-row-selected" : "")}
          onRow={(row) => ({
            onClick: () => void runs.select(row.id),
          })}
          columns={[
            { title: "实验", dataIndex: "label", ellipsis: true },
            {
              title: "状态",
              dataIndex: "status",
              width: 110,
              render: (status: string) => <Tag color={STATUS_COLOR[status] ?? "default"}>{status}</Tag>,
            },
            { title: "训练条数", dataIndex: "trainRows", width: 90 },
            { title: "验证条数", dataIndex: "evalRows", width: 90 },
            { title: "更新", dataIndex: "updatedAt", width: 180, render: (v: string) => v.replace("T", " ").slice(0, 19) },
            {
              title: "",
              width: 70,
              render: (_, row) => (
                <Popconfirm title="删除该实验目录？" onConfirm={() => void runs.remove(row.id)}>
                  <Button type="link" danger size="small" onClick={(e) => e.stopPropagation()}>
                    删除
                  </Button>
                </Popconfirm>
              ),
            },
          ]}
        />
      </Card>

      <Card title="① 种子数据">
        <Upload.Dragger {...uploadProps} disabled={uploading || isBusy("generate")}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">把监测表拖到这里，或点击选择文件</p>
          <p className="ant-upload-hint">Excel / CSV 需要有「错误词」「建议更正词」两列。</p>
        </Upload.Dragger>
      </Card>

      <Form form={form} layout="vertical" initialValues={{ mode: "fresh" }}>
        <Card title="② 检索来源">
          <Form.Item
            name="sources"
            extra="可多选。先用第一个来源，不够再用后面的。检索不到就少写，不会编造句子。"
            rules={[{ required: true, message: "请至少选择一个检索源" }]}
          >
            <Checkbox.Group
              options={sourceOpts.map((s) => ({
                label: (
                  <span className="source-option">
                    <strong>{s.title || s.name}</strong>
                    {s.description ? <span>{s.description}</span> : null}
                  </span>
                ),
                value: s.name,
              }))}
            />
          </Form.Item>
        </Card>

        <Card title="③ 生成参数">
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="cleanRatioPct" label="混入正常样本比例（%）">
                <InputNumber min={0} max={100} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="pairsPerTerm" label="每个词对最小句子数">
                <InputNumber min={1} max={20} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="maxWords" label="词条数上限（0=全部）">
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="maxPages" label="每词最大翻页数">
                <InputNumber min={1} max={20} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="seed" label="随机种子">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="minLen" label="句子最短字数">
                <InputNumber min={8} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="maxLen" label="句子最长字数">
                <InputNumber min={16} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="rpm" label="检索频率（次/分钟）">
                <InputNumber min={1} max={60} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="jitterSec" label="请求抖动（秒）">
                <InputNumber min={0} max={30} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={16}>
              <Form.Item name="formats" label="写出格式">
                <Checkbox.Group
                  options={[
                    { label: "messages", value: "messages" },
                    { label: "alpaca", value: "alpaca" },
                    { label: "sharegpt", value: "sharegpt" },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="instruction" label="系统提示词">
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card title="④ 生成">
          <Form.Item name="mode" label="方式">
            <Radio.Group
              optionType="button"
              options={[
                { value: "fresh", label: "全新生成" },
                { value: "resume", label: "继续未完成", disabled: !runs.selected?.canResume },
                { value: "continue", label: "在上次基础上追加", disabled: !runs.selectedId },
              ]}
            />
          </Form.Item>
          <Form.Item name="label" label="实验名称（全新 / 追加时使用）">
            <Input placeholder="例如 全量-人民网" />
          </Form.Item>
          <Space wrap>
            <Button type="primary" disabled={isBusy("generate") || !stats?.dict.exists} onClick={() => void runGenerate()}>
              生成训练集
            </Button>
            <Button disabled={isBusy("generate-eval") || !runs.selectedId} onClick={() => void runEvalGenerate()}>
              生成验证集
            </Button>
            <ConfirmDangerButton
              disabled={!job.busy}
              onConfirm={cancel}
              description="会立刻中断。已写入当前实验的 jsonl 会保留，下次可继续。"
            />
          </Space>
        </Card>
      </Form>

      {job.error && !job.busy ? <Alert type="error" showIcon message={job.error} /> : null}

      <LogCard lines={job.logs} busy={job.busy} jobName={job.job} onStop={cancel} />
    </>
  );
}
