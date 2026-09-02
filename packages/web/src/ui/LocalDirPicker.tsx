/**
 * 浏览本机目录，选出含 config.json 的模型文件夹。
 */
import { CheckCircleOutlined, FolderOutlined } from "@ant-design/icons";
import { Button, Empty, Input, Modal, Space, Spin, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";

interface FsRoot {
  name: string;
  path: string;
}

interface FsEntry {
  name: string;
  path: string;
  kind: "dir" | "model";
}

interface FsListing {
  cwd: string;
  parent: string | null;
  isModel: boolean;
  entries: FsEntry[];
}

export function LocalDirPicker({
  value,
  onChange,
}: {
  value?: string;
  onChange?: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roots, setRoots] = useState<FsRoot[]>([]);
  const [listing, setListing] = useState<FsListing | null>(null);

  const loadList = useCallback(async (dir: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fs/list?path=${encodeURIComponent(dir)}`);
      const body = (await res.json()) as { ok?: boolean; data?: FsListing; error?: string };
      if (!res.ok || !body.data) {
        setError(body.error || "无法读取目录");
        return;
      }
      setListing(body.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const res = await fetch("/api/fs/roots");
      const body = (await res.json()) as { data?: { roots?: FsRoot[] } };
      const next = body.data?.roots ?? [];
      setRoots(next);
      const start = value?.trim() || next[0]?.path;
      if (start) await loadList(start);
    })();
  }, [open, loadList, value]);

  return (
    <>
      <Space.Compact style={{ width: "100%" }}>
        <Input
          value={value}
          placeholder="例如 E:\models\Qwen2.5-0.5B-Instruct"
          onChange={(event) => onChange?.(event.target.value)}
        />
        <Button htmlType="button" onClick={() => setOpen(true)}>
          浏览
        </Button>
      </Space.Compact>
      <Modal
        title="选择本地模型目录"
        open={open}
        onCancel={() => setOpen(false)}
        okText="使用此目录"
        okButtonProps={{ disabled: !listing }}
        onOk={() => {
          if (listing) {
            onChange?.(listing.cwd);
            setOpen(false);
          }
        }}
        width={640}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          进入含 config.json 或 tokenizer 的模型目录，再点「使用此目录」。
        </Typography.Paragraph>
        <Space wrap style={{ marginBottom: 8 }}>
          {roots.map((root) => (
            <Button key={root.path} size="small" onClick={() => void loadList(root.path)}>
              {root.name}
            </Button>
          ))}
        </Space>
        {listing?.parent ? (
          <Button type="link" onClick={() => void loadList(listing.parent!)}>
            上级目录
          </Button>
        ) : null}
        <div>
          <Typography.Text code copyable>
            {listing?.cwd ?? ""}
          </Typography.Text>
        </div>
        {listing?.isModel ? (
          <Typography.Paragraph type="success" style={{ marginTop: 8 }}>
            <CheckCircleOutlined /> 当前目录看起来是模型权重
          </Typography.Paragraph>
        ) : null}
        {error ? <Typography.Paragraph type="danger">{error}</Typography.Paragraph> : null}
        <Spin spinning={loading}>
          <div style={{ maxHeight: 320, overflow: "auto", marginTop: 8 }}>
            {!listing?.entries.length && !loading ? <Empty description="没有子文件夹" /> : null}
            {listing?.entries.map((entry) => (
              <div key={entry.path} style={{ padding: "4px 0" }}>
                <Button
                  type="text"
                  icon={entry.kind === "model" ? <CheckCircleOutlined /> : <FolderOutlined />}
                  onClick={() => void loadList(entry.path)}
                >
                  {entry.name}
                  {entry.kind === "model" ? "（模型）" : ""}
                </Button>
              </div>
            ))}
          </div>
        </Spin>
      </Modal>
    </>
  );
}
