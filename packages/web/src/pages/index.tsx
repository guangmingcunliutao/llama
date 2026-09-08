/** 工作台：当前选中的数据实验。 */
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

  useEffect(() => {
    void fetch("/api/runs")
      .then((res) => res.json())
      .then((body: { data?: { workspace?: WorkspacePointer; data?: RunSummary[] } }) => {
        setWorkspace(body.data?.workspace ?? null);
        setData(body.data?.data ?? []);
      });
  }, [job.busy]);

  const currentData = data.find((row) => row.id === workspace?.dataRunId);

  return (
    <>
      <PageHeader title="工作台" description="固定表述纠错：本仓库准备数据，LlamaFactory 训练和评估，再回来对比超参。" />
      <PipelineStrip />
      <Row gutter={[12, 12]}>
        <Col xs={24} md={8}>
          <Card hoverable onClick={() => navigate("/data")}>
            <Statistic title="数据实验" value={data.length} suffix="次" />
            <Typography.Text type="secondary">{currentData ? `${currentData.label} · ${currentData.status}` : "尚未选择"}</Typography.Text>
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
