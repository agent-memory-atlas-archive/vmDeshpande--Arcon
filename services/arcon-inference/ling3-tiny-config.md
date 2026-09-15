# Ling 3.0 Tiny Experimental — Configuration Guide

## Overview

This document describes how to run the experimental Ling 3.0 Tiny inference path using llama.cpp. This is a separate experimental path — **Qwen/Qwen3-4B + Arcon V1 LoRA remains the active production model**.

## Prerequisites

### 1. Build llama.cpp with BailingMoE3 Support

BailingMoE3 (Ling 3.0 Tiny's architecture) support was merged into llama.cpp master on August 17, 2026 (PR #26608). Use a recent build:

```bash
git clone https://github.com/ggml-org/llama.cpp.git
cd llama.cpp
git pull  # ensure post-merge commit
cmake -B build -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=86  # RTX 3050 = sm_86
cmake --build build --config Release -j --target llama-server
```

If your build is older than the merge, use the community branch:
```bash
git clone --branch bailingmoe3-support https://github.com/aetherbird/llama.cpp.git
cd llama.cpp
cmake -B build -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=86
cmake --build build --config Release -j --target llama-server
```

### 2. Download Ling 3.0 Tiny GGUF

Download a quantized GGUF from `bloomer010/Ling-3.0-tiny-GGUF` on HuggingFace:

```bash
huggingface-cli download bloomer010/Ling-3.0-tiny-GGUF Ling-3.0-tiny-Q4_K_M.gguf --local-dir models/ling3-tiny/
```

Recommended quant: `Q4_K_M` (4.82 GB). Alternative: `Q3_K_M` (3.84 GB) if VRAM is tight.

### 3. Start llama.cpp Server

```bash
./build/bin/llama-server \
  -m models/ling3-tiny/Ling-3.0-tiny-Q4_K_M.gguf \
  -c 8192 \
  -ngl auto \
  --flash-attn auto \
  --host 127.0.0.1 \
  --port 8001 \
  --jinja \
  --temp 1.0 --top-p 0.95 --top-k 20
```

Note: `-ngl auto` offloads all GPU layers. On RTX 3050 6GB with Q4_K_M (~5GB weights + KV cache), this will use CPU offloading for KV cache. Adjust `-ngl` to control GPU offload layers.

## Configuration

Set these environment variables in `.env`:

```bash
# Experimental Ling 3.0 Tiny path (do NOT change without understanding implications)
ARCON_INFERENCE_BACKEND=ling3-tiny
LING3_TINY_BASE_URL=http://localhost:8001
LING3_TINY_MODEL=ling-tiny-q4-k-m

# Keep production settings for reference (not used when backend=ling3-tiny)
# ARCON_INFERENCE_BACKEND=arcon-lora
# ARCON_INFERENCE_BASE_URL=http://localhost:8000
# ARCON_ADAPTER_NAME=arcon-v1
```

### Important Notes

- **No LoRA adapter**: Ling 3.0 Tiny runs as base model only. Behavioral tuning from Arcon V1 adapter will NOT apply.
- **Separate port**: llama.cpp runs on port 8001, distinct from the Python inference service on 8000.
- **Speed**: Expected ~8-15 tokens/s on RTX 3050 6GB. Significantly slower than Qwen3-4B baseline.
- **VRAM**: Model weights + KV cache will exceed 6GB. llama.cpp handles this via CPU offloading (slower).
- **Context**: Set `-c 8192` for 8K context (sufficient for Arcon's ~20-turn usage). Increase to 131072 for full 128K testing.

## Environment Variable Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ARCON_INFERENCE_BACKEND` | Yes | `arcon-lora` | Set to `ling3-tiny` to activate |
| `LING3_TINY_BASE_URL` | Yes | — | llama.cpp server URL |
| `LING3_TINY_MODEL` | Yes | — | Model identifier string |

## Switching Back

To return to the production model:

1. Stop llama.cpp server (Ctrl+C)
2. Remove or comment out `LING3_TINY_*` env vars
3. Set `ARCON_INFERENCE_BACKEND=arcon-lora`
4. Restart the Node.js server

## Smoke Test

A smoke test script is available at `services/arcon-inference/smoke-test-ling3-tiny.js`. It follows the same pattern as the V1 smoke test but targets the llama.cpp endpoint.

Run:
```bash
node services/arcon-inference/smoke-test-ling3-tiny.js
```

Prerequisites: llama.cpp server running on port 8001 with the configured model.
