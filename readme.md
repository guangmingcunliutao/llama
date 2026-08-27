# llama

固定表述纠错分两块：

- **整条链路（含训练在别的文件夹时怎么接）**：见 [`pipeline.md`](pipeline.md)
- 数据工具：见 [`wx/README.md`](wx/README.md)
- 本仓库里的 LlamaFactory 示例配置：见 [`train/README.md`](train/README.md)

下面是本机环境安装备忘（WSL / LlamaFactory），与上面的数据流水线无关。

---

## ubuntu 安装

```bash
wsl --install -d Ubuntu-22.04
```

## ubuntu 进入

```bash
wsl -d Ubuntu-22.04
# 版本
hostnamectl
# 默认版本
wsl -l
wsl --set-default Ubuntu-22.04
```

## llamafactory 安装
```bash
# 依赖安装
sudo apt-get update
# 可以尝试不执行这一步，可能会报错，报错的话再执行这一步
sudo apt-get install -y python3-distutils
# nvidia 驱动确认
nvidia-smi
```

## llamafactory 拉取
```bash
git clone --depth 1 -b "main" https://github.com/hiyouga/LlamaFactory.git
```

### 用 modelscope 启动
```bash
### 要进入 llamafactory 目录
source finetune/bin/activate
cd LlamaFactory
export USE_MODELSCOPE_HUB=1 llamafactory-cli train my_configs/train_lora/train_stage1.yaml
# 继续执行
llamafactory-cli train my_configs/train_lora/qwen2.5-0.5b_lora_sft.yaml --resume_from_checkpoint my_outputs/qwen2.5-0.5b/lora/sft/checkpoint-15000
### chat
llamafactory-cli chat my_configs/inference/qwen2.5-0.5b_lora_sft.yaml
### merge
llamafactory-cli chat my_configs/merge_lora/qwen2.5-0.5b_lora_sft.yaml
```

### 配置项
```yaml
model_name_or_path: Qwen/Qwen2.5-0.5B-Instruct

### model
model_name_or_path: /home/tao/.cache/modelscope/models/Qwen--Qwen2.5-0.5B-Instruct/snapshots/master
trust_remote_code: true

### dataset
template: qwen
### 拷贝到当前目录下面来
mkdir -p /mnt/c/Users/tao/models
cp -a /home/tao/.cache/modelscope/models/Qwen--Qwen2.5-0.5B-Instruct/snapshots/master \
  /mnt/c/Users/tao/models/Qwen2.5-0.5B-Instruct
```
