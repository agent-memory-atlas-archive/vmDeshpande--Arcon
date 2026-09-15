# Ling 3.0 Tiny — Integration Investigation

## Date
2026-09-15

## Purpose
Evaluate `inclusionAI/Ling-3.0-tiny` as a potential alternative or experimental inference model for the Arcon runtime, distinct from the existing Qwen/Qwen3-4B + Arcon V1 LoRA production path.

**This investigation replaces the previous Ling 3.0 Flash assessment** (`docs/ling3-blocker-2026-09-04.md`). The Flash model (124B MoE) is NOT the target — Tiny (7.9B total / 1.3B active) is a fundamentally different model that may be feasible on current hardware.

---

## 1. Model Identification

| Property | Value |
|----------|-------|
| **Model ID** | `inclusionAI/Ling-3.0-tiny` |
| **Architecture** | Hybrid-linear MoE (BailingMoeV3 / `BailingMoeV3ForCausalLM`) |
| **Total parameters** | 7.9B |
| **Active parameters** | 1.3B per token |
| **Layers** | 24 (18 KDA + 6 Gated MLA, 3:1 ratio) |
| **Experts** | 128 routed, 8 active + 1 shared per token |
| **Context window** | 131,072 (128K) native |
| **License** | MIT |
| **Released** | September 1, 2026 |
| **Dataset** | Not applicable — pre-trained model |
| **Reasoning** | Native hybrid reasoning; `enable_thinking` toggles chain-of-thought |

### Available Checkpoints

| Variant | HuggingFace ID | Format | Approx. Size |
|---------|---------------|--------|-------------|
| BF16 | `inclusionAI/Ling-3.0-tiny` | Safetensors | 15.8 GB (32 shards) |
| FP8 | `inclusionAI/Ling-3.0-tiny-fp8` | Block FP8 | ~11 GB |
| INT4 | `inclusionAI/Ling-3.0-tiny-int4` | Compressed-tensors INT4 | ~8 GB |
| GGUF Q4_K_M | `bloomer010/Ling-3.0-tiny-GGUF` | GGUF (bailingmoe3) | 4.82 GB |
| GGUF Q3_K_M | `bloomer010/Ling-3.0-tiny-GGUF` | GGUF (bailingmoe3) | 3.84 GB |
| GGUF Q4_0 | `NANI-Nithin/Ling-3.0-tiny-GGUF` | GGUF | 4.22 GB |
| GGUF IQ4_NL | `NANI-Nithin/Ling-3.0-tiny-GGUF` | GGUF | 4.22 GB |

---

## 2. VRAM and System RAM Requirements

### Inference VRAM by Precision

| Precision | VRAM (weights) | Total with KV + overhead (8K ctx) | Fits RTX 3050 6GB? |
|-----------|---------------|----------------------------------|---------------------|
| BF16 | ~16.2 GB | ~18 GB | **No** (2.7× shortfall) |
| FP8 | ~11 GB | ~12.5 GB | **No** (2.1× shortfall) |
| INT4 (official) | ~8 GB | ~9.5 GB | **No** (1.6× shortfall) |
| Q4_K_M (GGUF) | ~4.8 GB | ~9.2 GB | **No** (1.5× shortfall) |
| Q4_0 (GGUF) | ~4.2 GB | ~8.4 GB | **No** (1.4× shortfall) |
| Q3_K_M (GGUF) | ~3.8 GB | ~7.2 GB | **No** (1.2× shortfall) |
| Q3_K_S (GGUF) | ~3.3 GB | ~6.5 GB | **Tight** (marginal) |
| IQ4_NL (GGUF) | ~4.2 GB | ~7.4 GB | **No** (1.23× shortfall) |

### With CPU Offloading (llama.cpp)

Using `llama-server -ngl 10` (full GPU offload) or lower for partial offload:

| Quant | GPU layers | VRAM used | CPU RAM used | Est. speed (RTX 3050 6GB) |
|-------|-----------|-----------|-------------|---------------------------|
| Q4_K_M | all 24 | ~5 GB | ~4 GB (KV cache) | ~8-15 tok/s (offload penalty) |
| Q3_K_M | all 24 | ~4 GB | ~3 GB | ~10-18 tok/s |
| Q4_0 | all 24 | ~4.5 GB | ~3.5 GB | ~8-16 tok/s |

**Note**: The 8GB RTX 3050 laptop has ~6GB usable VRAM after driver overhead. Full GPU offload of any 4-bit quant fits in VRAM, but total memory (VRAM + system RAM) is the binding constraint. With 16GB system RAM, CPU-side KV cache offloading is feasible.

### Reference: Comparable Hardware Results
- **NVIDIA Orin Nano Super 8GB** (unified memory): IQ4_NL at 33 tok/s decode, 128K context (2026-08 benchmark)
- **RTX 4060 Ti 16GB**: Q4_K_M at ~101 tok/s decode, 128K context
- **RTX 3060 12GB**: Q4_K_M at ~102 tok/s decode, 47K context

---

## 3. Python Inference Stack Compatibility

### Current Stack
`main.py` uses: `transformers` (AutoModelForCausalLM) + `peft` (PeftModel) + `bitsandbytes` (4-bit NF4)

### Compatibility: **NOT COMPATIBLE**

| Requirement | Status |
|-------------|--------|
| `BailingMoeV3ForCausalLM` class in transformers | **No** — not a standard transformers model class |
| `bailing_hybrid` model type | **No** — not recognized by transformers |
| PEFT/LoRA adapter loading | **No** — architecture does not support LoRA adapters |
| `trust_remote_code=True` | Partially — would need custom model code from inclusionAI |
| `BitsAndBytesConfig` NF4 | **No** — not applicable to this architecture |

**Conclusion**: Ling 3.0 Tiny CANNOT be served by the current Python inference service (`services/arcon-inference/main.py`). It requires a different inference backend entirely.

---

## 4. Backend Feasibility

| Backend | Compatible? | Notes |
|---------|------------|-------|
| **transformers + peft** | ❌ No | Custom architecture, no transformers support |
| **llama.cpp** (GGUF) | ✅ Yes | PR #26608 merged into master (Aug 17, 2026). BailingMoE3 architecture. Requires build from source (post-merge) or community fork (aetherbird/llama.cpp bailingmoe3-support). GGUF from bloomer010/Ling-3.0-tiny-GGUF or NANI-Nithin/Ling-3.0-tiny-GGUF. |
| **vLLM** (inclusionAI/vllm-ling-v3) | ✅ Yes | Requires `git clone -b ling_3_0 https://github.com/inclusionAI/vllm-ling-v3`. OpenAI-compatible endpoint. |
| **sglang** (dev-Ling-3.0-tiny) | ✅ Yes | Requires Docker: `lmsysorg/sglang:dev-Ling-3.0-tiny`. OpenAI-compatible endpoint. |
| **Ollama** | ⚠️ Partial | Official Ollama doesn't support it on NVIDIA. Ollama PR #17643 adds support via MLX (Apple Silicon only). Community Linux builds possible. |
| **Current Python service** | ❌ No | See Section 3 |

### Recommended Backend for Experimentation
**llama.cpp** — best fit for this project because:
1. OpenAI-compatible `/v1/chat/completions` endpoint (same as current ArconLoRAProvider)
2. Runs locally without Docker
3. Supports streaming via SSE
4. OpenAI-compatible model info endpoint `/v1/models`
5. Can CPU-offload when VRAM is insufficient
6. GGUF quantizations available for memory-constrained hardware

---

## 5. LoRA Adapter Support

### Not Available

- Ling 3.0 Tiny has **no LoRA adapters** — not trained with PEFT/LoRA
- The architecture (`BailingMoeV3ForCausalLM`) uses native MTP/NextN speculative decoding, not adapter-based tuning
- Arcon would run Ling 3.0 Tiny as a **base model only** (no behavioral tuning)
- This means Arcon's personality, emotion, and identity systems would rely entirely on the model's inherent capabilities rather than adapter-tuned behavior

**Impact**: Initial Ling 3.0 Tiny experiments will show base model behavior, which may differ significantly from Qwen3-4B + Arcon V1 LoRA personality characteristics.

---

## 6. Expected Generation Speed on RTX 3050 6GB

| Scenario | Estimated Speed | Notes |
|----------|----------------|-------|
| Full GPU offload, Q4_K_M, 8K context | ~8-15 tok/s | Aggressive quantization, limited by VRAM for KV cache |
| Full GPU offload, Q4_0, 4K context | ~12-20 tok/s | Smaller context reduces KV cache pressure |
| Partial GPU offload (ngl=15), Q4_K_M, 4K | ~5-10 tok/s | Heavy CPU→GPU transfer penalty |
| Qwen3-4B + V1 LoRA (current baseline) | ~15-30 tok/s | Current production speed |
| Llama.cpp, Q8_0, full GPU (if 8GB available) | ~25-40 tok/s | Higher quant, still feasible |

**Conclusion**: Ling 3.0 Tiny on RTX 3050 6GB will be **significantly slower** than the current Qwen3-4B baseline due to VRAM constraints forcing aggressive quantization or CPU offloading.

---

## 7. Context Length and Runtime Behavior

### Context Length
- Native: 131,072 (128K) tokens
- Arcon requirement: ~10K-20K tokens (20 turns × ~500-1000 tokens)
- **Comfortably exceeds Arcon's needs** — can handle far longer conversations

### Runtime Behavior Considerations
- `enable_thinking: true` → chain-of-thought reasoning (slower, better for complex tasks)
- `enable_thinking: false` → direct answers (faster, suitable for simple queries)
- Recommended sampling: `temperature=1.0`, `top_p=0.95`, `top_k=20`
- Tool calling: supported via `tool-call-parser ling3` (vLLM/sglang) or llama.cpp tool parsing
- The model has native agentic capabilities (tool use, planning) — potential future feature for Arcon

### Arcon Integration Points
- **System prompt**: Arcon's identity/relationship/behavior prompts would be prepended as a system message (same as current)
- **Capability recall**: Would need updated `RuntimeIdentity` reflecting Ling 3.0 Tiny instead of Qwen3-4B
- **Memory extraction**: Current `LlmMemoryExtractor` would work (it's just an LLM call)
- **No adapter**: Behavioral personality comes from base model only, not LoRA tuning

---

## 8. ModelProvider Integration Feasibility

### Compatible with Existing Abstraction: YES

All viable backends expose OpenAI-compatible REST APIs:

| Provider Class | Target | Methods Used |
|---------------|--------|-------------|
| `LlamaCppLingProvider` | llama.cpp server (port 8001+) | `generateReply`, `generateReplyStream`, `healthCheck`, `getModelInfo`, `getRuntimeIdentity` |
| `VllmLingProvider` | vLLM server (port 8001+) | Same |
| `SglangLingProvider` | sglang server (port 8001+) | Same |

### Integration Path (No Python→Node.js Merge Needed)

```
[Node.js Server] --HTTP--> [llama.cpp/vLLM/sglang server] --GPU--> [Ling 3.0 Tiny]
```

The `ModelProvider` abstraction already handles HTTP-based inference. The Node.js runtime would:
1. Start llama.cpp server separately (or assume it's running on a known port)
2. Create `LlamaCppLingProvider({ baseUrl: "http://localhost:8001", model: "ling-tiny-q4" })`
3. Pass it as `aiClient` to `ChatService` or `createApp()`
4. Use `ARCON_INFERENCE_BACKEND=ling3-tiny` to activate

### Required Environment Variables
```
ARCON_INFERENCE_BACKEND=ling3-tiny
LING3_TINY_BASE_URL=http://localhost:8001
LING3_TINY_MODEL=ling-tiny-q4-k-m
```

---

## Feasibility Summary

| Criterion | Verdict |
|-----------|---------|
| Fits on RTX 3050 6GB (GPU only) | ❌ No (any quant exceeds 6GB VRAM) |
| Fits with CPU offloading | ✅ Yes (tight, Q4 quant, 16GB system RAM) |
| Python inference stack | ❌ No (custom architecture) |
| llama.cpp | ✅ Yes (merged PR #26608) |
| vLLM / sglang | ✅ Yes (with special builds) |
| OpenAI-compatible API | ✅ Yes (via llama.cpp/vLLM) |
| LoRA adapter support | ❌ No (base model only) |
| ModelProvider abstraction | ✅ Yes (new provider class) |
| Performance on RTX 3050 6GB | ⚠️ Degraded (~8-15 tok/s) |
| Context length | ✅ Exceeds requirements (128K native) |

## Overall Assessment: TECHNICALLY FEASIBLE, PRACTICALLY LIMITED

Ling 3.0 Tiny is **NOT blocked** the same way Ling 3.0 Flash was (Flash was 124B and physically impossible on 6GB VRAM). Tiny at 7.9B CAN run locally with CPU offloading via llama.cpp, but at degraded speed.

### Recommended Path Forward
1. Create experimental `LlamaCppLingProvider` implementing `ModelProvider`
2. Configure via separate env vars (no changes to core config types)
3. Do NOT replace Qwen3-4B + Arcon V1 (remains active baseline)
4. Requires external llama.cpp server (not yet available in this environment)
5. A/B evaluation only after successful smoke test and hardware verification

### Prerequisites for Smoke Test
1. Build llama.cpp with BailingMoE3 support (PR #26608, master post-Aug 17 2026)
2. Download GGUF quantization (Q4_K_M, ~4.8 GB)
3. Start llama.cpp server: `llama-server -m Ling-3.0-tiny-Q4_K_M.gguf -c 8192 -ngl auto --port 8001`
4. Configure Arcon with `ARCON_INFERENCE_BACKEND=ling3-tiny`, `LING3_TINY_BASE_URL=http://localhost:8001`
5. Run smoke test with identity/behavioral prompts

---

## Preserved Paths (unchanged)
- `Qwen/Qwen3-4B` + `arcon-v1` LoRA: **ACTIVE runtime path** (unchanged)
- `Qwen/Qwen3-4B` (base, no adapter): available fallback (unchanged)
- V1/V2 training artifacts: locked (unchanged)
- V3 training: NOT started (unchanged)
- `services/arcon-inference/main.py`: unchanged (serves Qwen3-4B + LoRA only)
