/** 工作台：数据集规模与推荐流程。 */
import { Button, Card, Col, Row, Statistic, Typography } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useJob } from "../jobs/JobContext";
import { PageHeader } from "../ui/PageHeader";

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
        description="从种子生成纠错句对，在本机启动 LlamaFactory 训练，再评估与量化导出。"
      />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card hoverable onClick={() => navigate("/data")}>
            <Statistic title="词对" value={stats?.dict.rows ?? 0} />
            <Typography.Text type="secondary">数据生成 · 上传种子</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card hoverable onClick={() => navigate("/train")}>
            <Statistic title="训练样本" value={stats?.train.rows ?? 0} />
            <Typography.Text type="secondary">训练 · llamafactory-cli</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card hoverable onClick={() => navigate("/eval")}>
            <Statistic title="验证样本" value={stats?.eval.rows ?? 0} />
            <Typography.Text type="secondary">评估 · 独立检索验证集</Typography.Text>
          </Card>
        </Col>
      </Row>
      <Card title="推荐流程">
        <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
          <li>
            在「数据生成」上传监测表，设置检索与正常样本比例，生成训练集。
          </li>
          <li>用同一词对再生成验证集（句子不得出现在训练里）。</li>
          <li>在「训练」填写 LoRA / 学习率等超参，启动训练。</li>
          <li>「评估」用规则基线或 HTTP 接口打分；「训练分析」读 LlamaFactory 预测目录。</li>
          <li>需要上线时在「量化导出」把模型转成 GGUF。</li>
        </ol>
        <Button type="primary" style={{ marginTop: 16 }} onClick={() => navigate("/data")}>
          开始准备数据
        </Button>
      </Card>
    </>
  );
}
