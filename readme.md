# model-training

固定表述纠错：从错误词/正确词种子生成训练与验证 JSONL，在本仓库用 CLI 或 Web 启动 LlamaFactory 训练，评估模型，并可把本机模型量化为 GGUF。

## 快速开始

```bash
pnpm install
pnpm test
pnpm build
pnpm webui          # 浏览器打开终端里打印的地址（默认 127.0.0.1:5000）
pnpm mtrain --help
```

配置与 Web 表单是同一份 `model-training.config.json`（gitignore，首次启动 Web 会写出默认值）。

命令行与界面都可以直接开始训练（会 spawn `llamafactory-cli train`，需本机已安装 LlamaFactory 或设置 `LLAMAFACTORY_BIN`）：

```bash
pnpm mtrain generate
pnpm mtrain generate-eval
pnpm mtrain train
```

更完整的操作见 [docs/使用说明.md](docs/使用说明.md)。

## 目录

| 路径 | 作用 |
| --- | --- |
| `packages/core` | 字典、生成、训练启动、评估核心 |
| `packages/cli` | `mtrain` 命令 |
| `packages/server` | Fastify：`/api` + 托管前端 |
| `packages/web` | Vite + React + Ant Design（侧栏由 `pages` 的 `menu` 导出生成） |
| `uploads/` `outputs/` `cache/` | 运行时数据，不提交 |
