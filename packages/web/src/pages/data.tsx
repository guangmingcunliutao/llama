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
  const { job, start, cancel } = useJob();
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

  async function runGenerate(): Promise<void> {
    const values = await form.validateFields();
    await start("/api/jobs/generate", {
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
    });
  }

  return (
    <>
      <PageHeader
        title="数据生成"
        description="种子词对 + 权威站点检索 → 训练 JSONL。验证集单独再检索，不从训练集剥离句子。"
      />

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
        <Upload.Dragger {...uploadProps} disabled={uploading || job.busy}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽上传监测表 / 词对文件</p>
          <p className="ant-upload-hint">
            xlsx / csv 需含「错误词」「建议更正词」列；jsonl / json 将直接作为字典使用。
          </p>
        </Upload.Dragger>
      </Card>

      <Form form={form} layout="vertical">
      <Card title="② 检索来源">
          <Form.Item
            name="sources"
            extra="可多选。生成时按配置顺序补足句对缺口；语料不够时如实少写。"
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
              <Form.Item
                name="cleanRatioPct"
                label="混入正常样本比例（%）"
                extra="input=output 的正确句，避免逢句必改"
              >
                <InputNumber min={0} max={100} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="pairsPerTerm" label="每个词对最小句子数">
                <InputNumber min={1} max={20} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="maxWords" label="词条数上限（0=全部）" extra="试跑建议先填 20">
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
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          多检索源按缺口补足：先由第一个源尽力检索，不足再调用后续源。语料不够时如实少写，不虚构句子。
        </Typography.Paragraph>
      </Card>
      </Form>

      <Card title="④ 生成">
        <Space wrap>
          <Button type="primary" disabled={job.busy || !stats?.dict.exists} onClick={() => void runGenerate()}>
            生成训练集
          </Button>
          <Button
            disabled={job.busy || !stats?.train.exists}
            onClick={() => void start("/api/jobs/generate-eval")}
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
