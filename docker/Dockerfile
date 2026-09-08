# 单容器：本仓库 Web + LlamaFactory WebUI + 可选 SwanLab watch。
# 构建前请先在仓库根执行 pnpm install && pnpm build。
# 需要 NVIDIA Container Toolkit；无 GPU 时只能做数据，不能训练。
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    MODEL_TRAINING_HOST=0.0.0.0 \
    MODEL_TRAINING_PORT=5000 \
    MODEL_TRAINING_DATA=/data \
    LLAMAFACTORY_WEBUI_URL=http://127.0.0.1:7860 \
    SWANLAB_WATCH_URL=http://127.0.0.1:5092 \
    GRADIO_SERVER_NAME=0.0.0.0 \
    SWANLAB_MODE=local \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git python3 python3-pip python3-venv \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone --depth 1 https://github.com/hiyouga/LlamaFactory.git \
    && pip3 install --no-cache-dir -e "./LlamaFactory[torch,metrics,swanlab]" \
    && pip3 install --no-cache-dir "swanlab[dashboard]" \
    && ln -sf /usr/bin/python3 /usr/bin/python

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY docker ./docker
RUN corepack enable && pnpm install --frozen-lockfile \
    && pnpm build \
    && chmod +x /app/docker/entrypoint.sh

EXPOSE 5000 7860 5092
VOLUME ["/data"]
ENTRYPOINT ["/app/docker/entrypoint.sh"]
