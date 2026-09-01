import { Card, Typography } from "antd";
import type { ReactNode } from "react";

/** 各页共用的标题卡：说明短、边距小。 */
export function PageHeader({
  title,
  description,
  extra,
}: {
  title: string;
  description?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <Card size="small" className="page-hero">
      <div className="page-hero-row">
        <div>
          <Typography.Title level={4} className="page-title">
            {title}
          </Typography.Title>
          {description ? (
            <Typography.Paragraph type="secondary" className="page-desc">
              {description}
            </Typography.Paragraph>
          ) : null}
        </div>
        {extra}
      </div>
    </Card>
  );
}
