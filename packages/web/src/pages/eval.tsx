/** 用训练后的模型对验证集推理并打分。 */
import { Alert, Button, Card, Collapse, Empty, Form, Input, Popconfirm, Radio, Select, Space, Table, Tag, Typography } from "antd";
import { App as AntdApp } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useJob } from "../jobs/JobContext";
import { formatRunTime } from "../runs/format";
import { useRuns } from "../runs/useRuns";
import { ConfirmDangerButton } from "../ui/ConfirmDangerButton";
import { LogCard } from "../ui/LogCard";
import { PageHeader } from "../ui/PageHeader";
import { PipelineStrip } from "../ui/PipelineStrip";

export const menu = { title: "评估", icon: "ExperimentOutlined", order: 30 };

const STATUS_COLOR: Record<string, string> = {
  running: "processing",
  completed: "success",
  interrupted: "warning",
  failed: "error",
  pending: "default",
};

export default function EvalPage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const { job, start, cancel } = useJob(["infer", "evaluate"]);
  const trainRuns = useRuns("train");
  const evalRuns = useRuns("eval");
  const [form] = Form.useForm();
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null);
  const locked = job.busy;
  const trainRunId = Form.useWatch("trainRunId", form) as string | undefined;
  const mode = Form.useWatch("mode", form) as "fresh" | "resume" | undefined;
  const selectedTrain = trainRuns.rows.find((row) => row.id === trainRunId);

  function evalBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const id = String(form.getFieldValue("trainRunId") ?? trainRuns.selectedId ?? "").trim();
    const row = trainRuns.rows.find((item) => item.id === id);
    const evalMode = String(form.getFieldValue("mode") ?? "fresh");
    return {
      trainRunId: id || undefined,
      dataRunId: row?.dataRunId || undefined,
      mode: evalMode,
      runId: evalMode === "resume" ? evalRuns.selectedId ?? undefined : undefined,
      label: String(form.getFieldValue("label") ?? "").trim() || undefined,
      ...extra,
    };
  }

  useEffect(() => {
    if (locked) return;
    void (async () => {
      const [cfgRes, reportRes] = await Promise.all([fetch("/api/config"), fetch("/api/reports")]);
      const cfgBody = (await cfgRes.json()) as {
        data?: { train?: { outputDir?: string } };
      };
      const reportBody = (await reportRes.json()) as { data?: { metrics?: Record<string, unknown> | null } };
      form.setFieldsValue({
        trainRunId: cfgBody.data && trainRuns.selectedId ? trainRuns.selectedId : trainRuns.rows.find((r) => r.adapterReady)?.id,
        mode: evalRuns.selected?.canResume ? "resume" : "fresh",
        label: evalRuns.selected?.label ?? "",
      });
      setMetrics(reportBody.data?.metrics ?? null);
    })();
  }, [form, locked, trainRuns.selectedId, trainRuns.rows, evalRuns.selected, evalRuns.selectedId]);

  useEffect(() => {
    if (!job.busy) void evalRuns.refresh();
  }, [job.busy, evalRuns.refresh]);

  async function runModelEval(): Promise<void> {
    const id = String(form.getFieldValue("trainRunId") ?? trainRuns.selectedId ?? "").trim();
    if (!id) {
      message.warning("请选择一次训练实验");
      return;
    }
    if (form.getFieldValue("mode") === "resume" && !evalRuns.selected?.canResume) {
      message.warning(evalRuns.selected?.resumeHint || "当前评估实验不能续跑，请全新评估");
      return;
    }
    await start("/api/jobs/infer", evalBody({ backend: "llamafactory", all: true }));
  }

  return (
    <>
      <PageHeader
        title="评估"
        description="用某次训练实验的 LoRA 改验证集句子，计算纠错分数。中断后可对同一评估实验继续未完成切片。"
      />
      <PipelineStrip />
      {job.error && !job.busy ? <Alert type="error" showIcon message={job.error} /> : null}
      {import.meta.env.DEV ? (
        <Alert
          type="info"
          showIcon
          message="评估会跑很久。开发模式下不要重启 pnpm server:dev，也不要改 packages/core：接口一重启，正在跑的评估会被掐掉。"
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Card title="评估实验" extra={evalRuns.selected?.resumeHint}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          {evalRuns.selected
            ? `当前实验「${evalRuns.selected.label}」。继续未完成会写入这一份，已完成的预测切片会跳过。`
            : "点选一行作为当前评估实验。中断过的实验可以继续。"}
        </Typography.Paragraph>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={evalRuns.rows}
          onRow={(row) => ({
            onClick: locked
              ? undefined
              : () => {
                  void evalRuns.select(row.id);
                  form.setFieldsValue({
                    mode: row.canResume ? "resume" : "fresh",
                    trainRunId: row.trainRunId || form.getFieldValue("trainRunId"),
                    label: row.label,
                  });
                },
          })}
          rowClassName={(row) => (row.id === evalRuns.selectedId ? "ant-table-row-selected" : "")}
          columns={[
            {
              title: "实验",
              dataIndex: "label",
              ellipsis: true,
              render: (label: string, row: { id: string }) => (
                <Space size={6}>
                  {row.id === evalRuns.selectedId ? <Tag color="blue">当前</Tag> : null}
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
            { title: "已预测", dataIndex: "evalRows", width: 80, render: (v: number | undefined) => v ?? 0 },
            { title: "更新", dataIndex: "updatedAt", width: 180, render: (v: string) => formatRunTime(v) },
            {
              title: "",
              width: 70,
              render: (_, row) => (
                <Popconfirm title="删除该评估实验？" onConfirm={() => void evalRuns.remove(row.id)}>
                  <Button type="link" danger size="small" disabled={locked} onClick={(e) => e.stopPropagation()}>
                    删除
                  </Button>
                </Popconfirm>
              ),
            },
          ]}
        />
      </Card>
      <Card title="训练模型">
        <Form form={form} layout="vertical" disabled={locked} initialValues={{ mode: "fresh" }}>
          <Form.Item
            name="mode"
            label="方式"
            extra={
              evalRuns.selected?.canResume
                ? evalRuns.selected.resumeHint || "可从中断处继续"
                : "全新评估会新建实验目录。继续未完成需要点选上方中断过的评估实验。"
            }
          >
            <Radio.Group
              optionType="button"
              options={[
                { value: "fresh", label: "全新评估" },
                { value: "resume", label: "继续未完成", disabled: !evalRuns.selected?.canResume },
              ]}
            />
          </Form.Item>
          <Form.Item name="label" label="实验名称" extra="全新评估时使用。">
            <Input placeholder="例如 wx-eval" />
          </Form.Item>
          <Form.Item
            name="trainRunId"
            label="训练实验"
            extra={
              selectedTrain?.dataRunId
                ? `目录里有 adapter 的实验才能评估。验证集用这次训练绑定的数据实验 ${selectedTrain.dataRunId}，与正在生成的新数据无关。`
                : "目录里有 adapter 的实验才能评估。验证集跟所选训练实验走，不跟正在准备的新数据走。"
            }
          >
            <Select
              placeholder="选择训练实验"
              options={trainRuns.rows.map((row) => ({
                value: row.id,
                label: `${row.label}（${row.status}${row.adapterReady ? " · adapter" : ""}）`,
                disabled: !row.adapterReady && row.status !== "completed",
              }))}
            />
          </Form.Item>
        </Form>
        <Typography.Paragraph type="secondary">
          加载该目录中的模型，对验证集做生成，写出预测和 metrics.json。
        </Typography.Paragraph>
        <Space wrap>
          <Button type="primary" htmlType="button" disabled={job.busy} onClick={() => void runModelEval()}>
            {mode === "resume" ? "继续评估" : "开始评估"}
          </Button>
          <Button htmlType="button" onClick={() => navigate("/analyze")}>
            下一步：调参
          </Button>
          <ConfirmDangerButton
            disabled={!job.busy}
            onConfirm={() => cancel(job.job ?? "infer")}
            description="会立刻中断。已写完的预测切片会保留，下次可继续未完成。"
          />
        </Space>
        <Collapse
          style={{ marginTop: 16 }}
          items={[
            {
              key: "more",
              label: "已有预测时仅打分 / 规则上界（对照）",
              children: (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    已有预测时仅打分：不加载模型，用当前评估实验的 pred.jsonl 重新算分；若当前实验还没有预测，会改用最近一次已有预测的实验。规则上界：按词表把错词换成正词，用来估计上限，会覆盖页面上的模型分数。
                  </Typography.Paragraph>
                  <Space wrap>
                    <Button
                      htmlType="button"
                      disabled={job.busy}
                      onClick={() => void start("/api/jobs/evaluate", evalBody({ mode: undefined, runId: undefined }))}
                    >
                      已有预测时仅打分
                    </Button>
                    <Button
                      htmlType="button"
                      disabled={job.busy}
                      onClick={() =>
                        void start(
                          "/api/jobs/infer",
                          evalBody({ backend: "rule", baseline: true, all: true, mode: "fresh" }),
                        )
                      }
                    >
                      规则上界（对照）
                    </Button>
                  </Space>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Card title="纠错指标">
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          exact_match：整句与标准答案一致。term_fix_rate：该改的词改对了。copy_input_rate：原样复述错句。keep：本身正确的句子不应被改坏。
        </Typography.Paragraph>
        {metrics ? (
          <pre className="report-pre">{JSON.stringify(metrics, null, 2)}</pre>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有指标。请先有验证集和训练产出，再点「开始评估」。" />
        )}
      </Card>
      <LogCard lines={job.logs} busy={job.busy} jobName={job.job} onStop={() => cancel(job.job ?? "infer")} />
    </>
  );
}
