/**
 * 数据生成：上传种子、选择检索源、填写生成参数。
 * 检索源的展示名来自配置 title/description，提交时仍用 name。
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
  Row,
  Space,
  Statistic,
  Typography,
  Upload,
} from "antd";
import type { UploadProps } from "antd";
import { App as AntdApp } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useJob } from "../jobs/JobContext";
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
  output: string;
}

export default function DataPage() {
  const { message } = AntdApp.useApp();
  const { job, start, cancel, isBusy } = useJob(["generate", "generate-eval"]);
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
      output: "",
    });
  }, [form]);

  useEffect(() => {
    void loadStats();
    void loadConfig();
  }, [loadStats, loadConfig]);

  useEffect(() => {
    if (!job.busy) void loadStats();
  }, [job.busy, loadStats]);

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
      pairsPerTerm: values.pairsPerTerm,
      limitTerms: values.maxWords && values.maxWords > 0 ? values.maxWords : 0,
      cleanRatio: values.cleanRatioPct,
      maxPages: values.maxPages,
      seed: values.seed,
      format: values.formats.join(","),
      sources: values.sources,
      instruction: values.instruction,
      output: values.output || undefined,
      sentence: { minLen: values.minLen, maxLen: values.maxLen },
      rate: { requestsPerMinute: values.rpm, jitterSec: values.jitterSec },
    };
  }

  async function runGenerate(): Promise<void> {
    await start("/api/jobs/generate", await generateBody());
  }

  async function runEvalGenerate(): Promise<void> {
    await start("/api/jobs/generate-eval", await generateBody());
  }

  return (
    <>
      <PageHeader
        title="数据生成"
        description="上传错词/正词表，检索真实句子做成训练和验证材料。每条样本：input 是待改的句子，output 是改对后的句子。"
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
            <Statistic title="训练集" value={stats?.train.rows ?? 0} suffix="条" />
            <Typography.Text className="stat-path">
              {stats?.train.exists ? stats.train.path : "尚未生成"}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="验证集" value={stats?.eval.rows ?? 0} suffix="条" />
            <Typography.Text className="stat-path">
              {stats?.eval.exists ? stats.eval.path : "尚未生成"}
            </Typography.Text>
          </Card>
        </Col>
      </Row>

      <Card title="① 种子数据">
        <Upload.Dragger {...uploadProps} disabled={uploading || isBusy("generate")}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">把监测表拖到这里，或点击选择文件</p>
          <p className="ant-upload-hint">Excel / CSV 需要有「错误词」「建议更正词」两列。</p>
        </Upload.Dragger>
      </Card>

      <Form form={form} layout="vertical">
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
          <Typography.Paragraph type="secondary">
            训练集和验证集用同一套参数。验证集句子不会和训练重复。每条都有待改句（input）和规范句（output）；再按比例混入本身正确、不应改动的句子。
          </Typography.Paragraph>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item
                name="cleanRatioPct"
                label="混入正常样本比例（%）"
                extra="input 与 output 相同的正确句，避免模型见句就改。"
              >
                <InputNumber min={0} max={100} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="pairsPerTerm" label="每个词对最小句子数" extra="每个词至少写几条错句。越大数据越多。">
                <InputNumber min={1} max={20} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="maxWords" label="词条数上限（0=全部）" extra="试跑可填 20，全量填 0。">
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="maxPages" label="每词最大翻页数" extra="检索翻几页。语料不够时不会凭空多写。">
                <InputNumber min={1} max={20} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="seed" label="随机种子">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="output" label="输出文件名（可选）">
                <Input placeholder="默认 outputs/sft/train.jsonl" />
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
      </Form>

      <Card title="④ 生成">
        <Space wrap>
          <Button type="primary" disabled={isBusy("generate") || !stats?.dict.exists} onClick={() => void runGenerate()}>
            生成训练集
          </Button>
          <Button
            disabled={isBusy("generate-eval") || !stats?.train.exists}
            onClick={() => void runEvalGenerate()}
          >
            生成验证集
          </Button>
          <ConfirmDangerButton disabled={!job.busy} onConfirm={cancel} />
        </Space>
      </Card>

      {job.error && !job.busy ? <Alert type="error" showIcon message={job.error} /> : null}

      <LogCard lines={job.logs} busy={job.busy} jobName={job.job} onStop={cancel} />
    </>
  );
}
