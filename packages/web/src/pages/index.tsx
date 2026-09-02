/** 工作台：数据集规模与推荐流程。 */
import { Button, Card, Col, Row, Statistic, Typography } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useJob } from "../jobs/JobContext";
import { PIPELINE } from "../pipeline";
import { PageHeader } from "../ui/PageHeader";
import { PipelineStrip } from "../ui/PipelineStrip";

export const menu = { title: "概览", icon: "HomeOutlined", order: 0 };

interface FileStat {
  exists: boolean;
  rows: number;
  path: string | null;
}

export default function OverviewPage() {
  const navigate = useNavigate();
  const { job } = useJob();
  const [stats, setStats] = useState<{ dict: FileStat; train: FileStat; eval: FileStat } | null>(null);

  useEffect(() => {
    void fetch("/api/datasets")
      .then((res) => res.json())
      .then((body: { data?: { dict: FileStat; train: FileStat; eval: FileStat } }) => {
        if (body.data) setStats(body.data);
      });
  }, [job.busy]);

  return (
    <>
      <PageHeader
        title="工作台"
        description="固定表述纠错：数据生成 → 训练 → 评估 → 调参 → 导出。"
      />
      <PipelineStrip />
      <Row gutter={[12, 12]}>
        <Col xs={24} md={8}>
          <Card hoverable onClick={() => navigate("/data")}>
            <Statistic title="词对" value={stats?.dict.rows ?? 0} />
            <Typography.Text type="secondary">数据生成 · 上传种子</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card hoverable onClick={() => navigate("/train")}>
            <Statistic title="训练样本" value={stats?.train.rows ?? 0} />
            <Typography.Text type="secondary">训练页使用的句对</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card hoverable onClick={() => navigate("/eval")}>
            <Statistic title="验证样本" value={stats?.eval.rows ?? 0} />
            <Typography.Text type="secondary">评估页打分用，不参与训练</Typography.Text>
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
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          评估看纠错分数。调参根据预测给下一轮超参建议，不再跑模型。
        </Typography.Paragraph>
        <Button type="primary" style={{ marginTop: 16 }} onClick={() => navigate("/data")}>
          从数据开始
        </Button>
      </Card>
    </>
  );
}
