# model-training

固定表述纠错：从错误词/正确词种子生成训练与验证 JSONL，导出给 [LlamaFactory](https://github.com/hiyouga/LlamaFactory) WebUI 训练，再在本仓库评估、对比超参，并可量化为 GGUF。

## 快速开始

```bash
pnpm install
pnpm test
pnpm build
pnpm webui          # 浏览器打开 127.0.0.1:5000
pnpm mtrain --help
```

配置与 Web 表单是同一份 `model-training.config.json`（gitignore，首次启动 Web 会写出默认值）。

主路径：本仓库生成数据 → 数据页打开 LlamaFactory（自动拉起 WebUI）训练/评估 → 回本仓库调参对比。

```bash
pnpm mtrain generate
pnpm mtrain generate-eval
pnpm mtrain export-lf
```

Docker（宿主机浏览器打开映射端口，需要 NVIDIA Container Toolkit）：

```bash
cd docker
docker compose up --build
# http://127.0.0.1:5000  本仓库
# http://127.0.0.1:7860  LlamaFactory
# http://127.0.0.1:5092  SwanLab 离线看板（可选）
```

更完整的操作见 [docs/使用说明.md](docs/使用说明.md)。

## 目录

| 路径 | 作用 |
| --- | --- |
| `packages/core` | 字典、生成、训练启动、评估核心 |
| `packages/cli` | `mtrain` 命令 |
| `packages/server` | Fastify：`/api` + 托管前端 |
| `packages/web` | Vite + React + Ant Design（侧栏由 `pages` 的 `menu` 导出生成） |
| `docker/` | 单容器：Web + LlamaFactory WebUI + 可选 SwanLab |
| `outputs/lf` | 给 WebUI 的稳定数据集目录 |
| `outputs/lf-runs` | 每次训练的 output_dir |
| `uploads/` `outputs/` `cache/` | 运行时数据，不提交 |
