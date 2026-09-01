import { Card, Empty, Typography } from "antd";

export function LogCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <Card size="small" title={title}>
      {lines.length ? (
        <pre className="log-pre">{lines.join("\n")}</pre>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Typography.Text type="secondary">
              还没有日志。启动任务后，这里会滚动显示检索、训练或评估输出。
            </Typography.Text>
          }
        />
      )}
    </Card>
  );
}