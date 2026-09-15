# Ling 3 Model Integration — Blocker Report

## Verification Date
2026-09-04

## Model Identification
- **Official model ID**: `inclusionAI/Ling-3.0-flash` (Hugging Face, verified)
- **Architecture**: Hybrid-linear MoE (35 KDA + 7 Gated MLA layers, 5:1 ratio)
- **Parameters**: 124B total / 5.1B active per token
- **Context**: 8K → 32K → 256K training schedule
- **License**: MIT (confirmed on Hugging Face)
- **Released**: August 4, 2026

## Hardware Requirements

| Quant | Weights | Total at 8K | Fits RTX 3050 6GB? |
|-------|---------|-------------|---------------------|
| FP4 (MXFP4) official | 70.40 GB | 81.1 GB | **No** (13× shortfall) |
| INT4 official | 77.01 GB | 88.7 GB | **No** |
| Q4_K_M community | 69.70 GB | 86.2 GB | **No** |
| IQ3_XXS community | 47.9 GB | N/A | **No** (8× shortfall) |

## Backend Compatibility

**NOT compatible with current Python inference service** (`services/arcon-inference/main.py`):
- Current service uses `transformers` + `peft` (PEFT/LoRA on standard HF models)
- Ling 3.0 uses `bailing_hybrid` model type — NOT supported by `transformers`/`peft`
- Requires specialized inference: `sglang` with `inclusionAI/vllm` fork (ling_3_0 branch) or patched `llama.cpp` (bailing_hybrid architecture)

## Streaming Support
Yes — via vLLM/sglang OpenAI-compatible endpoints. The Node.js `ArconLoRAProvider` uses OpenAI-compatible `/v1/chat/completions` which would work with vLLM/sglang.

## LoRA/PEFT Support
Not applicable — MoE architecture uses native MTP (speculative decoding), not LoRA adapters.

## Decision
**Ling 3 cannot run on current hardware (RTX 3050 6GB) and cannot be served by current Python inference stack.**

## Integration Path (for future evaluation)
1. Acquire hardware: minimum 96GB GPU (e.g., RTX PRO 6000 Blackwell) or multi-GPU setup
2. Deploy Ling 3 via vLLM with `inclusionAI/vllm` fork (ling_3_0 branch), OpenAI-compatible endpoint
3. Create `Ling3Provider` implementing `ModelProvider` interface (packages/ai/src/model-provider.ts)
4. Configure via `ARCON_INFERENCE_BACKEND=ling3` in server config
5. Run A/B evaluation: Ling 3 vs Qwen3-4B/V1 on Arcon evaluation benchmarks

## Preserved Paths (unchanged)
- `Qwen/Qwen3-4B` + `arcon-v1` LoRA adapter: ACTIVE runtime path
- `Qwen/Qwen3-4B` (base, no adapter): available fallback
- `train_arcon_v1.py` / `train_arcon_v2.py`: training scripts (V3 training NOT started)
- `training/outputs/arcon-v1/adapter/`: V1 adapter (active)
- `training/outputs/arcon-v2/adapter/`: V2 adapter (trained, inactive)
