#!/usr/bin/env bash
# =============================================================================
# LlamaFactory 一键安装（@model-training/core/scripts）
# 适用于 WSL / Linux / Git Bash。
#
# 源码与虚拟环境写到 INSTALL_ROOT（默认：调用时的数据仓库根），不写进本脚本所在包目录。
#   INSTALL_ROOT/LlamaFactory   官方仓库
#   INSTALL_ROOT/finetune       uv 虚拟环境
#
# 环境变量示例:
#   INSTALL_ROOT=/data/mt PYTHON_VERSION=3.11 TORCH_CUDA=cu126 bash install-llamafactory.sh
#   TORCH_CUDA=cpu        bash install-llamafactory.sh
# =============================================================================

if [ -z "${BASH_VERSION:-}" ]; then
    if command -v bash >/dev/null 2>&1; then
        exec bash "$0" "$@"
    else
        echo "[错误] 此脚本需要 bash, 请先安装: sudo apt-get install -y bash" >&2
        exit 1
    fi
fi

set -euo pipefail

PYTHON_VERSION="${PYTHON_VERSION:-3.11}"
LLAMAFACTORY_BRANCH="${LLAMAFACTORY_BRANCH:-main}"
PIP_INDEX_URL="${PIP_INDEX_URL:-https://mirrors.aliyun.com/pypi/simple}"
TORCH_CUDA="${TORCH_CUDA:-auto}"
VENV_NAME="${VENV_NAME:-finetune}"

c_info() { printf '\033[1;34m[信息]\033[0m %s\n' "$*"; }
c_ok()   { printf '\033[1;32m[完成]\033[0m %s\n' "$*"; }
c_warn() { printf '\033[1;33m[警告]\033[0m %s\n' "$*"; }
c_err()  { printf '\033[1;31m[错误]\033[0m %s\n' "$*" >&2; }

on_error() { c_err "安装失败, 出错位置: 第 $1 行"; exit 1; }
trap 'on_error $LINENO' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${INSTALL_ROOT:-}" ]]; then
    mkdir -p "$INSTALL_ROOT"
    INSTALL_ROOT="$(cd "$INSTALL_ROOT" && pwd)"
else
    # 本仓库: packages/core/scripts -> 仓库根；独立安装包则以当前目录为准
    if [[ -f "$SCRIPT_DIR/../../../pnpm-workspace.yaml" ]]; then
        INSTALL_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
    else
        INSTALL_ROOT="$(pwd)"
    fi
fi
mkdir -p "$INSTALL_ROOT"
cd "$INSTALL_ROOT"
c_info "脚本: $SCRIPT_DIR/install-llamafactory.sh"
c_info "安装根目录: $INSTALL_ROOT"

# uv 默认缓存往往在用户目录；与 venv 不在同一盘时无法 hardlink。
# 缓存必须落在 INSTALL_ROOT 下（同盘），即使环境里已有 UV_CACHE_DIR 也不沿用异盘子目录。
case "${UV_CACHE_DIR:-}" in
    "$INSTALL_ROOT"/*) ;;
    *) UV_CACHE_DIR="$INSTALL_ROOT/.cache/uv" ;;
esac
case "${UV_PYTHON_INSTALL_DIR:-}" in
    "$INSTALL_ROOT"/*) ;;
    *) UV_PYTHON_INSTALL_DIR="$INSTALL_ROOT/.cache/uv-python" ;;
esac
mkdir -p "$UV_CACHE_DIR" "$UV_PYTHON_INSTALL_DIR"
export UV_CACHE_DIR UV_PYTHON_INSTALL_DIR
c_info "uv 缓存: $UV_CACHE_DIR（与安装根同盘）"

activate_venv() {
    if [[ -f "$INSTALL_ROOT/$VENV_NAME/bin/activate" ]]; then
        # shellcheck disable=SC1091
        source "$INSTALL_ROOT/$VENV_NAME/bin/activate"
    elif [[ -f "$INSTALL_ROOT/$VENV_NAME/Scripts/activate" ]]; then
        # shellcheck disable=SC1091
        source "$INSTALL_ROOT/$VENV_NAME/Scripts/activate"
    else
        c_err "找不到虚拟环境激活脚本: $INSTALL_ROOT/$VENV_NAME"
        exit 1
    fi
}

install_system_deps() {
    if [[ "$(uname -s)" == "Darwin" ]]; then
        c_info "检测到 macOS, 跳过系统依赖安装(请确保已装 git/curl)"
        return
    fi
    if ! command -v sudo &>/dev/null; then
        c_warn "未找到 sudo, 跳过系统依赖安装(请确保已具备 git/curl/gcc)"
        return
    fi
    if   command -v apt-get &>/dev/null; then
        c_info "检测到 Debian/Ubuntu, 安装基础依赖..."
        sudo apt-get update -qq
        sudo apt-get install -y git curl ca-certificates build-essential
    elif command -v dnf &>/dev/null; then
        c_info "检测到 Fedora/RHEL, 安装基础依赖..."
        sudo dnf install -y git curl gcc gcc-c++ make
    elif command -v yum &>/dev/null; then
        c_info "检测到 CentOS/RHEL, 安装基础依赖..."
        sudo yum install -y git curl gcc gcc-c++ make
    else
        c_warn "未识别的包管理器, 请确保已安装 git / curl / gcc"
    fi
}

ensure_uv() {
    if command -v uv &>/dev/null; then
        c_ok "uv 已安装: $(uv --version 2>/dev/null || echo unknown)"
        return
    fi
    c_info "安装 uv ..."
    if command -v curl &>/dev/null; then
        curl -LsSf https://astral.sh/uv/install.sh | sh
    elif command -v python3 &>/dev/null; then
        python3 -m pip install --user uv
    else
        c_err "需要 curl 或 python3 来安装 uv"; exit 1
    fi
    export PATH="$HOME/.local/bin:$PATH"
    hash -r
    command -v uv &>/dev/null || { c_err "uv 安装失败, 请参考 https://docs.astral.sh/uv/ 手动安装"; exit 1; }
    c_ok "uv 安装完成: $(uv --version)"
}

clone_repo() {
    if [[ -d "LlamaFactory/.git" ]]; then
        c_warn "LlamaFactory 目录已存在, 跳过克隆(如需更新: rm -rf LlamaFactory 后重跑)"
        return
    fi
    c_info "克隆 LlamaFactory (github) ..."
    git clone --depth 1 -b "$LLAMAFACTORY_BRANCH" https://github.com/hiyouga/LlamaFactory.git
    c_ok "克隆完成"
}

create_venv() {
    c_info "准备 Python ${PYTHON_VERSION}(由 uv 统一管理, 不污染系统)..."
    uv python install "$PYTHON_VERSION" >/dev/null
    if [[ ! -d "$VENV_NAME" ]]; then
        c_info "创建虚拟环境 ${VENV_NAME} ..."
        uv venv --python "$PYTHON_VERSION" "$VENV_NAME"
    else
        c_warn "虚拟环境 ${VENV_NAME} 已存在, 沿用"
    fi
    activate_venv

    if ! python -m pip --version &>/dev/null; then
        c_info "补装 pip ..."
        python -m ensurepip --upgrade 2>/dev/null || uv pip install pip
    fi

    c_ok "已激活虚拟环境: $(python --version 2>&1)"
}

pip_index_args=()
build_pip_index_args() {
    pip_index_args=()
    if [[ -n "$PIP_INDEX_URL" ]]; then
        pip_index_args=(--index-url "$PIP_INDEX_URL")
    fi
}

install_torch_gpu() {
    local cuda

    case "$TORCH_CUDA" in
        auto)
            cuda="cu126"
            ;;
        cpu)
            c_info "安装 CPU 版 torch..."
            uv pip uninstall torch torchvision torchaudio 2>/dev/null || true
            uv pip install torch torchvision torchaudio --index-url "https://download.pytorch.org/whl/cpu"
            return
            ;;
        *)
            cuda="$TORCH_CUDA"
            ;;
    esac

    c_info "检测到 NVIDIA GPU, 将安装 CUDA 版 torch (${cuda})"
    c_info "安装 GPU 版 torch (${cuda})..."

    uv pip uninstall torch torchvision torchaudio 2>/dev/null || true

    uv pip install torch==2.6.0 torchvision==0.21.0 torchaudio==2.6.0 \
        --index-url "https://download.pytorch.org/whl/${cuda}"
}

install_deps() {
    cd "$INSTALL_ROOT/LlamaFactory"
    build_pip_index_args

    install_torch_gpu

    c_info "安装 LlamaFactory 及全部依赖..."
    uv pip install -e . "${pip_index_args[@]}"

    c_info "安装 metrics 依赖(nltk / jieba / rouge-chinese)..."
    uv pip install -r requirements/metrics.txt "${pip_index_args[@]}" || c_warn "metrics 安装失败(非必需, 可稍后手动安装)"

    c_info "锁定 trl 版本到 >=0.18.0,<=0.24.0 ..."
    uv pip install "trl>=0.18.0,<=0.24.0" "${pip_index_args[@]}"
}

verify() {
    cd "$INSTALL_ROOT/LlamaFactory"
    activate_venv 2>/dev/null || true
    echo
    c_info "验证 LlamaFactory 版本:"
    llamafactory-cli version
    c_info "验证 torch / CUDA:"
    python -c "import torch; print('torch', torch.__version__, '| CUDA available:', torch.cuda.is_available())"
    c_info "验证关键依赖:"
    python -c "import omegaconf; print('omegaconf', omegaconf.__version__)"
    python -c "import trl; print('trl', trl.__version__)"
}

install_system_deps
ensure_uv
clone_repo
create_venv
install_deps
verify

echo
c_ok "==================== 安装完成 ===================="
echo "启动 WebUI:   cd $INSTALL_ROOT/LlamaFactory && llamafactory-cli webui"
echo "再次激活环境: source $INSTALL_ROOT/$VENV_NAME/bin/activate"
