/**
 * 右下角环境入口：LlamaFactory 只需装一次，不占训练页。
 */
import { ToolOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, FloatButton, Form, Input, Select, Space, Typography } from "antd";
import { App as AntdApp } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useJob } from "../jobs/JobContext";
import { ConfirmDangerButton } from "./ConfirmDangerButton";
import { LogCard } from "./LogCard";

interface EnvDetect {
  ok: boolean;
  home: string | null;
  python: string | null;
  bin: string | null;
  mode: "module" | "cli" | null;
  errors: string[];
  notes: string[];
}

export function EnvironmentFab() {
  const { message } = AntdApp.useApp();
  const { job, start, cancel, isBusy } = useJob("lf-install");
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [env, setEnv] = useState<EnvDetect | null>(null);

  const probe = useCallback(async (): Promise<EnvDetect | null> => {
    const home = String(form.getFieldValue("lfHome") ?? "").trim();
    const bin = String(form.getFieldValue("lfBin") ?? "").trim();
    const params = new URLSearchParams();
    if (home) params.set("home", home);
    if (bin) params.set("bin", bin);
    setChecking(true);
    try {
      const qs = params.toString();
      const res = await fetch(`/api/train/env${qs ? `?${qs}` : ""}`);
      const body = (await res.json()) as { data?: EnvDetect; error?: string };
      const next = body.data ?? {
        ok: false,
        home: null,
        python: null,
        bin: null,
        mode: null,
        errors: [body.error ?? "检测失败"],
        notes: [],
      };
      setEnv(next);
      return next;
    } finally {
      setChecking(false);
    }
  }, [form]);

  useEffect(() => {
    void fetch("/api/config")
      .then((res) => res.json())
      .then((body: { data?: Record<string, unknown> }) => {
        const lf = (body.data?.llamafactory ?? {}) as { home?: string; bin?: string };
        form.setFieldsValue({
          lfHome: lf.home ?? "",
          lfBin: lf.bin ?? "",
          torchCuda: "auto",
          pipIndexUrl: "https://mirrors.aliyun.com/pypi/simple",
        });
      })
      .then(() => {
        void probe();
      });
  }, [form, probe, job.busy]);

  async function persistHome(): Promise<void> {
    const home = String(form.getFieldValue("lfHome") ?? "").trim();
    const bin = String(form.getFieldValue("lfBin") ?? "").trim();
    const current = (await fetch("/api/config").then((res) => res.json())) as { data?: Record<string, unknown> };
    const prev = (current.data ?? {}) as Record<string, unknown>;
    const lf = { ...((prev.llamafactory as object) ?? {}), home, bin };
    await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...prev, llamafactory: lf }),
    });
  }

  return (
    <>
      <FloatButton
        className="env-fab"
        icon={<ToolOutlined />}
        tooltip="训练环境（只需装一次）"
        badge={env && !env.ok ? { dot: true } : undefined}
        onClick={() => setOpen(true)}
      />
      <Drawer
        title="训练环境"
        open={open}
        forceRender
        onClose={() => setOpen(false)}
        width={440}
        extra={
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            装好后训练页只填执行目录
          </Typography.Text>
        }
      >
        <Typography.Paragraph>
          这一步通常只做一次：在本机装好 LlamaFactory。之后训练页填它的目录即可。
        </Typography.Paragraph>
        <Form form={form} layout="vertical" initialValues={{ torchCuda: "auto" }}>
          <Form.Item name="lfHome" label="安装 / 执行目录" extra="一键安装会写到仓库下的 LlamaFactory 文件夹。请输入完整路径。">
            <Input placeholder="例如 E:\llama\LlamaFactory" />
          </Form.Item>
          <Form.Item name="lfBin" label="命令文件（可留空）" extra="一般不用填，程序会在目录里自己找。">
            <Input placeholder="llamafactory-cli 的完整路径" />
          </Form.Item>
          <Form.Item name="torchCuda" label="显卡 / CPU">
            <Select
              options={[
                { value: "auto", label: "有独显（默认）" },
                { value: "cu124", label: "CUDA 12.4" },
                { value: "cpu", label: "仅 CPU（更慢）" },
              ]}
            />
          </Form.Item>
          <Form.Item name="pipIndexUrl" label="软件下载源">
            <Input />
          </Form.Item>
        </Form>
        <Space wrap>
          <Button
            htmlType="button"
            loading={checking}
            onClick={() =>
              void (async () => {
                await persistHome();
                const next = await probe();
                if (next?.ok) message.success("环境可用");
              })()
            }
          >
            检测是否已装好
          </Button>
          <Button
            htmlType="button"
            type="primary"
            disabled={isBusy("lf-install") || checking}
            onClick={() =>
              void (async () => {
                const values = form.getFieldsValue(true);
                await persistHome();
                await start("/api/jobs/lf-install", {
                  home: String(values.lfHome ?? "").trim(),
                  torchCuda: values.torchCuda,
                  pipIndexUrl: values.pipIndexUrl,
                });
                await probe();
              })()
            }
          >
            一键安装
          </Button>
          <ConfirmDangerButton disabled={!job.busy} onConfirm={cancel} />
        </Space>
        {env ? (
          <Alert
            style={{ marginTop: 16 }}
            type={env.ok ? "success" : "warning"}
            showIcon
            message={env.ok ? "已经可以训练" : "还没装好"}
            description={
              <Typography.Paragraph style={{ marginBottom: 0 }}>
                {env.python ? <div>Python：{env.python}</div> : null}
                {env.bin ? <div>命令：{env.bin}</div> : null}
                {env.notes.map((line) => (
                  <div key={line}>{line}</div>
                ))}
                {env.errors.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </Typography.Paragraph>
            }
          />
        ) : null}
        <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
          也可按{" "}
          <Typography.Link
            href="https://llamafactory.readthedocs.io/en/latest/getting_started/installation.html"
            target="_blank"
          >
            官方说明
          </Typography.Link>{" "}
          自己安装，再把文件夹选进来。
        </Typography.Paragraph>
        <LogCard lines={job.logs} busy={job.busy} jobName={job.job} onStop={cancel} />
      </Drawer>
    </>
  );
}
