import { Typography } from "antd";
import type { ReactNode } from "react";

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
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 16,
        marginBottom: 20,
      }}
    >
      <div>
        <Typography.Title level={3} className="page-title">
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
  );
}
