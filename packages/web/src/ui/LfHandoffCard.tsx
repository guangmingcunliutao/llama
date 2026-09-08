/** 数据页上跳转到 LlamaFactory：展示已导出目录、拉起 WebUI。数据集在生成完成时已写入 outputs/lf。 */
import { Button, Card, Collapse, Input, Select, Space, Typography } from "antd";
import { App as AntdApp } from "antd";
import { useEffect, useState } from "react";

interface LfArtifact {
  id: string;
  label: string;
  adapterReady: boolean;
  dataRunId: string | null;
  outputDir: string;
  outputDirForLf?: string;
}

interface LfView {
  datasetDirForLf: string;
  hasTrain: boolean;
  datasets: string[];
  webuiUrl: string;
  swanlabUrl: string;
  swanlabLogDirForLf?: string;
  artifacts: LfArtifact[];
}

export function LfHandoffCard(props: { refreshKey?: string | number | null }) {
  const { message } = AntdApp.useApp();
  const [lfView, setLfView] = useState<LfView | null>(null);
  const [slotLabel, setSlotLabel] = useState("");
  const [prepared, setPrepared] = useState<{ outputDirForLf: string; id: string } | null>(null);
  const [evalPrep, setEvalPrep] = useState<{
    outputDirForLf: string;
    adapterDirForLf: string;
    evalDataset: string;
    evalRunId: string;
  } | null>(null);
  const [trainId, setTrainId] = useState<string>();
  const [opening, setOpening] = useState(false);

  async function refreshLf(): Promise<LfView | null> {
    const res = await fetch("/api/lf");
    const body = (await res.json()) as { data?: LfView };
    if (body.data) setLfView(body.data);
    return body.data ?? null;
  }

  useEffect(() => {
    void refreshLf();
  }, [props.refreshKey]);

  async function prepareOutput(): Promise<string | null> {
    const res = await fetch("/api/lf/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: slotLabel }),
    });
    const body = (await res.json()) as {
      ok?: boolean;
      error?: string;
      data?: { id: string; outputDirForLf: string };
    };
    if (!body.ok || !body.data) {
      message.error(body.error || "准备输出目录失败");
      return null;
    }
    setPrepared({ id: body.data.id, outputDirForLf: body.data.outputDirForLf });
    await refreshLf();
    return body.data.outputDirForLf;
  }

  async function openLlamaFactory(): Promise<void> {
    setOpening(true);
    try {
      const view = (await refreshLf()) ?? lfView;
      if (!view?.hasTrain) {
        message.error("还没有 WebUI 数据集。请先在本页生成训练集（完成后会写入数据实验目录的 dataset_info.json）。");
        return;
      }
      let output: string | undefined = prepared?.outputDirForLf;
      if (!output) output = (await prepareOutput()) ?? undefined;
      const res = await fetch("/api/lf/webui/ensure", { method: "POST" });
      const body = (await res.json()) as { ok?: boolean; error?: string; data?: { url?: string } };
      if (!body.ok) {
        message.error(body.error || "无法启动 LlamaFactory");
        return;
      }
      const dataset = view.datasetDirForLf;
      if (dataset) {
        await navigator.clipboard.writeText(dataset).catch(() => undefined);
        message.success("已复制数据集目录（train.dataset_dir）。输出目录见下方，需另贴到 output_dir。");
      } else if (output) {
        await navigator.clipboard.writeText(output).catch(() => undefined);
        message.success("已复制本次输出目录，在 WebUI 里粘贴为 output_dir");
      }
      window.open(body.data?.url || view.webuiUrl || "http://127.0.0.1:7860", "_blank", "noopener");
    } finally {
      setOpening(false);
    }
  }

  async function openSwanlab(): Promise<void> {
    setOpening(true);
    try {
      const res = await fetch("/api/lf/swanlab/ensure", { method: "POST" });
      const body = (await res.json()) as { ok?: boolean; error?: string; data?: { url?: string; hint?: string } };
      if (!body.ok) {
        message.error(body.error || "无法启动 SwanLab");
        return;
      }
      if (body.data?.hint) message.info(body.data.hint);
      window.open(body.data?.url || "http://127.0.0.1:5092", "_blank", "noopener");
    } finally {
      setOpening(false);
    }
  }

  async function prepareEval(): Promise<void> {
    if (!trainId) {
      message.warning("请选择一次已有 LoRA 的训练");
      return;
    }
    const res = await fetch("/api/lf/prepare-eval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trainRunId: trainId }),
    });
    const body = (await res.json()) as {
      ok?: boolean;
      error?: string;
      data?: { outputDirForLf: string; adapterDirForLf: string; evalDataset: string; evalRunId: string };
    };
    if (!body.ok || !body.data) {
      message.error(body.error || "准备评估失败");
      return;
    }
    setEvalPrep(body.data);
    message.success("已建好评估输出目录。WebUI 切到 Evaluate 后填这些路径。");
  }

  async function importScore(): Promise<void> {
    const row = lfView?.artifacts.find((item) => item.id === trainId);
    const res = await fetch("/api/lf/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        evalRunId: evalPrep?.evalRunId,
        trainRunId: trainId,
        dataRunId: row?.dataRunId,
      }),
    });
    const body = (await res.json()) as { ok?: boolean; error?: string };
    if (!body.ok) {
      message.error(body.error || "导入失败");
      return;
    }
    message.success("已导入预测并打分，可去调参页对比");
  }

  const readyAdapters = lfView?.artifacts.filter((row) => row.adapterReady) ?? [];

  return (
    <Card title="交给 LlamaFactory">
      <Typography.Paragraph type="secondary">
        生成结束后会在该次数据实验目录写入 dataset_info.json（直接用 train.jsonl，不再另拷到
        outputs/lf），并更新 LlamaFactory llamaboard_config 里的 train.dataset_dir。WebUI 数据路径填下方目录，数据集选
        term_train
        {lfView?.hasEval ? " / term_eval" : ""}。
      </Typography.Paragraph>
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <Typography.Text copyable={lfView?.datasetDirForLf ? { text: lfView.datasetDirForLf } : false}>
          数据集目录：{lfView?.datasetDirForLf || "请先生成训练集"}
        </Typography.Text>
        {prepared ? (
          <Typography.Text copyable={{ text: prepared.outputDirForLf }}>
            本次输出目录：{prepared.outputDirForLf}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">打开时会自动建一个空的输出目录（与数据集目录分开）。</Typography.Text>
        )}
        <Space wrap>
          <Input
            style={{ width: 200 }}
            placeholder="输出目录备注，如 lr1e-4"
            value={slotLabel}
            onChange={(e) => setSlotLabel(e.target.value)}
          />
          <Button type="primary" htmlType="button" loading={opening} onClick={() => void openLlamaFactory()}>
            打开 LlamaFactory
          </Button>
          <Button htmlType="button" loading={opening} onClick={() => void openSwanlab()}>
            打开训练曲线
          </Button>
        </Space>
        <Typography.Text type="secondary">
          SwanLab 日志目录：{lfView?.swanlabLogDirForLf || "outputs/swanlog"}（Extra：mode=local；目录已与训练对齐，不必在 WebUI
          再填）
        </Typography.Text>
      </Space>
      <Collapse
        style={{ marginTop: 16 }}
        items={[
          {
            key: "eval",
            label: "评估：Evaluate 跑完后导入预测",
            children: (
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Select
                  placeholder="选择已有 LoRA 的训练"
                  style={{ width: "100%" }}
                  value={trainId}
                  onChange={setTrainId}
                  options={readyAdapters.map((row) => ({ value: row.id, label: row.label }))}
                />
                {evalPrep ? (
                  <>
                    <Typography.Text copyable={{ text: evalPrep.adapterDirForLf }}>
                      adapter：{evalPrep.adapterDirForLf}
                    </Typography.Text>
                    <Typography.Text copyable={{ text: evalPrep.outputDirForLf }}>
                      评估输出目录：{evalPrep.outputDirForLf}
                    </Typography.Text>
                  </>
                ) : null}
                <Space wrap>
                  <Button htmlType="button" onClick={() => void prepareEval()}>
                    准备评估目录
                  </Button>
                  <Button htmlType="button" onClick={() => void importScore()}>
                    导入预测并打分
                  </Button>
                </Space>
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );
}
