/**
 * 各页共用的流程条，避免「评估」和「调参」看起来像同一件事。
 */
import { Card, Steps } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import { PIPELINE } from "../pipeline";

export function PipelineStrip() {
  const location = useLocation();
  const navigate = useNavigate();
  const index = PIPELINE.findIndex(
    (step) => location.pathname === step.path || location.pathname.startsWith(`${step.path}/`),
  );

  return (
    <Card size="small" className="pipeline-strip">
      <Steps
        size="small"
        current={index < 0 ? -1 : index}
        onChange={(next) => navigate(PIPELINE[next]!.path)}
        items={PIPELINE.map((step) => ({
          title: step.title,
          description: step.blurb,
        }))}
      />
    </Card>
  );
}
