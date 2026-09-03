/**
 * 数据生成：上传种子检索句对，或直接导入现成训练集并划分验证集。
 */
import { UploadOutlined } from "@ant-design/icons";
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
  Tooltip,
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
  evalSeen?: FileStat;
  evalUnseen?: FileStat;
  evalKeep?: FileStat;
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
  const { job, start, cancel } = useJob(["generate", "generate-eval"]);
  const runs = useRuns("data");
  const [stats, setStats] = useState<DatasetStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingTrain, setUploadingTrain] = useState(false);
  const [sourceOpts, setSourceOpts] = useState<SourceItem[]>([]);
  const [form] = Form.useForm<GenForm>();
  const locked = job.busy;

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
    if (locked) return;
    if (runs.selected?.canResume) form.setFieldValue("mode", "resume");
  }, [runs.selected?.canResume, form, locked]);

  useEffect(() => {
    void loadStats();
  }, [runs.selectedId, loadStats]);

  const uploadProps: UploadProps = {
    name: "file",
    multiple: false,
    showUploadList: false,
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

  const trainUploadProps: UploadProps = {
    name: "file",
    multiple: false,
    showUploadList: false,
    maxCount: 1,
    accept: ".jsonl,.json",
    customRequest: async (options) => {
      const file = options.file as File;
      const formData = new FormData();
      formData.append("file", file);
      setUploadingTrain(true);
      try {
        const res = await fetch("/api/upload/train", { method: "POST", body: formData });
        const body = (await res.json()) as {
          ok: boolean;
          error?: string;
          data?: DatasetStatus & {
            imported?: {
              runId: string;
              imported: number;
              train: number;
              eval: number;
              eval_seen_pair: number;
              eval_unseen_pair: number;
              eval_keep: number;
            };
          };
        };
        if (!res.ok) {
          options.onError?.(new Error(body.error || "上传失败"));
          message.error(body.error || "上传失败");
          return;
        }
        if (body.data) setStats(body.data);
        await runs.refresh();
        options.onSuccess?.(body);
        const imported = body.data?.imported;
        message.success(
          imported
            ? `已导入 ${imported.imported} 条：训练 ${imported.train}，验证 ${imported.eval}（seen ${imported.eval_seen_pair} / unseen ${imported.eval_unseen_pair} / keep ${imported.eval_keep}）`
            : "训练数据已导入并划分验证集",
        );
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        options.onError?.(err as Error);
        message.error(text);
      } finally {
        setUploadingTrain(false);
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
        description="每次生成是一次数据实验，写在 outputs/data 下。可以从词对检索生成，也可以直接上传已经整理好的训练 jsonl，系统会按词对划分验证集。"
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
            <Typography.Text className="stat-path">
              {runs.selected ? `${runs.selected.label} · ${runs.selected.id}` : "未选实验"}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="验证全集 eval" value={runs.selected?.evalRows ?? stats?.eval.rows ?? 0} suffix="条" />
            <Typography.Text className="stat-path">
              {runs.selected ? `${runs.selected.label} · seen + unseen` : "点选实验后显示"}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="seen 词对见过" value={stats?.evalSeen?.rows ?? 0} suffix="条" />
            <Typography.Text className="stat-path">
              {runs.selectedId ? `${runs.selectedId}/eval/eval_seen_pair.jsonl` : "eval_seen_pair.jsonl"}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="unseen 词对未见" value={stats?.evalUnseen?.rows ?? 0} suffix="条" />
            <Typography.Text className="stat-path">
              {runs.selectedId ? `${runs.selectedId}/eval/eval_unseen_pair.jsonl` : "eval_unseen_pair.jsonl"}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="keep 规范句" value={stats?.evalKeep?.rows ?? 0} suffix="条" />
            <Typography.Text className="stat-path">
              {runs.selectedId ? `${runs.selectedId}/eval/eval_keep.jsonl` : "eval_keep.jsonl"}
            </Typography.Text>
          </Card>
        </Col>
      </Row>

      <Card
        title="数据实验"
        extra={
          <Space wrap>
            <Tooltip title="Excel / CSV，需有「错误词」「建议更正词」两列">
              <Upload {...uploadProps} disabled={uploading || uploadingTrain || locked}>
                <Button icon={<UploadOutlined />} loading={uploading} disabled={uploadingTrain || locked}>
                  上传种子
                </Button>
              </Upload>
            </Tooltip>
            <Tooltip title="已整理好的 jsonl（messages / alpaca / sharegpt）。导入后新建实验并划分验证集">
              <Upload {...trainUploadProps} disabled={uploading || uploadingTrain || locked}>
                <Button icon={<UploadOutlined />} loading={uploadingTrain} disabled={uploading || locked}>
                  上传训练数据
                </Button>
              </Upload>
            </Tooltip>
            {runs.selected?.resumeHint ? (
              <Typography.Text type="secondary">{runs.selected.resumeHint}</Typography.Text>
            ) : null}
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          {runs.selected
            ? `当前实验「${runs.selected.label}」。生成验证集只写入这一份（outputs/data/${runs.selected.id}/eval/），不会混进其它实验。`
            : "点选一行作为当前实验。生成验证集、训练都会用这一份。"}
        </Typography.Paragraph>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={runs.rows}
          rowClassName={(row) => (row.id === runs.selectedId ? "ant-table-row-selected" : "")}
          onRow={(row) => ({
            onClick: locked ? undefined : () => void runs.select(row.id),
          })}
          columns={[
            {
              title: "实验",
              dataIndex: "label",
              ellipsis: true,
              render: (label: string, row) => (
                <Space size={6}>
                  {row.id === runs.selectedId ? <Tag color="blue">当前</Tag> : null}
                  <span>{label}</span>
                </Space>
              ),
            },
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
                  <Button type="link" danger size="small" disabled={locked} onClick={(e) => e.stopPropagation()}>
                    删除
                  </Button>
                </Popconfirm>
              ),
            },
          ]}
        />
      </Card>

      <Form form={form} layout="vertical" disabled={locked} initialValues={{ mode: "fresh" }}>
        <Card title="① 检索来源">
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

        <Card title="② 生成参数">
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

        <Card title="③ 生成" extra={locked ? "生成进行中，参数已锁定" : undefined}>
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
        </Card>
      </Form>
      <Card>
        <Space wrap>
          <Button type="primary" disabled={locked || !stats?.dict.exists} onClick={() => void runGenerate()}>
            生成训练集
          </Button>
          <Popconfirm
            title="生成验证集"
            description={
              runs.selected
                ? `写入当前实验「${runs.selected.label}」（${runs.selected.id}）的 eval/，只用这一份训练集排除泄漏。`
                : "请先在表格中点选一个数据实验"
            }
            okText="生成"
            disabled={locked || !runs.selectedId}
            onConfirm={() => void runEvalGenerate()}
          >
            <Button disabled={locked || !runs.selectedId}>生成验证集</Button>
          </Popconfirm>
          <ConfirmDangerButton
            disabled={!locked}
            onConfirm={() => cancel(job.job ?? undefined)}
            description="会立刻中断。已写入当前实验的 jsonl 会保留，下次可继续。"
          />
        </Space>
        {runs.selected ? (
          <Typography.Paragraph type="secondary" style={{ margin: "8px 0 0" }}>
            验证集目标：{runs.selected.label}（{runs.selected.id}），训练 {runs.selected.trainRows ?? 0} 条
            {runs.selected.evalRows ? `，已有验证 ${runs.selected.evalRows} 条` : ""}
          </Typography.Paragraph>
        ) : (
          <Typography.Paragraph type="secondary" style={{ margin: "8px 0 0" }}>
            请先点选表格中的数据实验，再生成验证集。
          </Typography.Paragraph>
        )}
      </Card>

      {job.error && !job.busy ? <Alert type="error" showIcon message={job.error} /> : null}

      <LogCard lines={job.logs} busy={job.busy} jobName={job.job} onStop={() => cancel(job.job ?? undefined)} />
    </>
  );
}
