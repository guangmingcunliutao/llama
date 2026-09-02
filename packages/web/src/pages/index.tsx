/** 工作台：当前选中的数据 / 训练 / 评估实验。 */
import { Button, Card, Col, Row, Statistic, Typography } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useJob } from "../jobs/JobContext";
import { PIPELINE } from "../pipeline";
import type { RunSummary, WorkspacePointer } from "../runs/types";
import { PageHeader } from "../ui/PageHeader";
import { PipelineStrip } from "../ui/PipelineStrip";

export const menu = { title: "概览", icon: "HomeOutlined", order: 0 };

export default function OverviewPage() {
  const navigate = useNavigate();
  const { job } = useJob();
  const [workspace, setWorkspace] = useState<WorkspacePointer | null>(null);
  const [data, setData] = useState<RunSummary[]>([]);
  const [train, setTrain] = useState<RunSummary[]>([]);
  const [evalRuns, setEvalRuns] = useState<RunSummary[]>([]);

  useEffect(() => {
    void fetch("/api/runs")
      .then((res) => res.json())
      .then((body: { data?: { workspace?: WorkspacePointer; data?: RunSummary[]; train?: RunSummary[]; eval?: RunSummary[] } }) => {
        setWorkspace(body.data?.workspace ?? null);
        setData(body.data?.data ?? []);
        setTrain(body.data?.train ?? []);
        setEvalRuns(body.data?.eval ?? []);
      });
  }, [job.busy]);

  const currentData = data.find((row) => row.id === workspace?.dataRunId);
  const currentTrain = train.find((row) => row.id === workspace?.trainRunId);
  const currentEval = evalRuns.find((row) => row.id === workspace?.evalRunId);

  return (
    <>
      <PageHeader title="工作台" description="固定表述纠错：数据实验 → 训练实验 → 评估实验。产物按实验 id 分目录保存。" />
      <PipelineStrip />
      <Row gutter={[12, 12]}>
        <Col xs={24} md={8}>
          <Card hoverable onClick={() => navigate("/data")}>
            <Statistic title="数据实验" value={data.length} suffix="次" />
            <Typography.Text type="secondary">{currentData ? `${currentData.label} · ${currentData.status}` : "尚未选择"}</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card hoverable onClick={() => navigate("/train")}>
            <Statistic title="训练实验" value={train.length} suffix="次" />
            <Typography.Text type="secondary">{currentTrain ? `${currentTrain.label} · ${currentTrain.status}` : "尚未选择"}</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card hoverable onClick={() => navigate("/eval")}>
            <Statistic title="评估实验" value={evalRuns.length} suffix="次" />
            <Typography.Text type="secondary">{currentEval ? `${currentEval.label} · ${currentEval.status}` : "尚未选择"}</Typography.Text>
          </Card>
        </Col>
      </Row>
      <Card title="整条链路">
        <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
          {PIPELINE.map((step) => (
            <li key={step.path}>
              <Typography.Link onClick={() => navigate(step.path)}>{step.title}</Typography.Link>
              {" — "}
              {step.detail}
            </li>
          ))}
        </ol>
        <Button type="primary" style={{ marginTop: 16 }} onClick={() => navigate("/data")}>
          从数据开始
        </Button>
      </Card>
    </>
  );
}
