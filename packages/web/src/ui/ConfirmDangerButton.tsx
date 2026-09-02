import { Button, Popconfirm } from "antd";
import type { ReactNode } from "react";

/** 停止任务等不可轻易撤销的操作，必须点确认。 */
export function ConfirmDangerButton({
  disabled,
  onConfirm,
  label = "停止",
  title = "确认停止当前任务？",
  description = "生成或训练会立刻中断。已经写出的文件会保留，未完成的部分不会继续。",
}: {
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
  label?: ReactNode;
  title?: string;
  description?: string;
}) {
  return (
    <Popconfirm
      title={title}
      description={description}
      okText="确认停止"
      cancelText="取消"
      okButtonProps={{ danger: true }}
      disabled={disabled}
      onConfirm={() => void onConfirm()}
    >
      <Button danger htmlType="button" disabled={disabled}>
        {label}
      </Button>
    </Popconfirm>
  );
}
