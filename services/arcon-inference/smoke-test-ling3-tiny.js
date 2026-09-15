#!/usr/bin/env node
/**
 * Arcon Ling 3.0 Tiny Experimental Smoke Test.
 *
 * Starts a llama.cpp server with Ling 3.0 Tiny (if not already running),
 * then starts the Node.js server and sends 10 prompts.
 *
 * Prerequisites:
 * 1. llama.cpp built with BailingMoE3 support (PR #26608)
 * 2. Ling-3.0-tiny-Q4_K_M.gguf downloaded
 * 3. llama.cpp server running on port 8001
 *
 * Usage: node services/arcon-inference/smoke-test-ling3-tiny.js
 */

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import http from "node:http";

const LING3_PORT = 8001;
const SERVER_PORT = 3002;
const GGUF_PATH = process.env.LING3_GGUF_PATH ?? "models/ling3-tiny/Ling-3.0-tiny-Q4_K_M.gguf";

function waitForHealth(url, timeoutMs = 600_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    async function check() {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timeout waiting for ${url}`));
        return;
      }
      try {
        const response = await fetch(`${url}/health`);
        if (response.ok) { resolve(); return; }
      } catch { /* not ready yet */ }
      await delay(2000);
      check();
    }
    check();
  });
}

function postChat(serverUrl, message) {
  return new Promise((resolve, reject) => {
    const url = new URL("/chat", serverUrl);
    const body = JSON.stringify({ message });
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function getModelInfo(serverUrl) {
  return new Promise((resolve, reject) => {
    http.get(new URL("/model-info", serverUrl), (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    }).on("error", reject);
  });
}

async function terminateProcess(label, child, timeoutMs = 5000) {
  if (child.killed || child.exitCode !== null) {
    return { code: child.exitCode, signal: child.signalCode, stdout: "", stderr: "" };
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.on("exit", () => { clearTimeout(timer); resolve(undefined); });
  });
  return { code: child.exitCode, signal: child.signalCode, stdout: "", stderr: "" };
}

async function main() {
  console.log("=".repeat(60));
  console.log("Arcon Ling 3.0 Tiny Experimental Smoke Test");
  console.log("=".repeat(60));

  const ling3Env = {
    ...process.env,
    LING3_TINY_BASE_URL: `http://127.0.0.1:${LING3_PORT}`,
    LING3_TINY_MODEL: "ling-tiny-q4-k-m",
    ARCON_INFERENCE_BACKEND: "ling3-tiny",
    PORT: String(SERVER_PORT),
  };

  console.log(`\n[1/4] Checking for llama.cpp server on port ${LING3_PORT}...`);
  let ling3Ready = false;
  try {
    await waitForHealth(`http://127.0.0.1:${LING3_PORT}`, 60_000);
    ling3Ready = true;
    console.log("  llama.cpp server ready.");
  } catch {
    console.log("  llama.cpp server not found. Attempting to start...");
    const llamaServer = spawn(process.env.LLAMA_SERVER_PATH ?? "llama-server", [
      `-m${GGUF_PATH}`,
      `-c8192`,
      `-ngl=auto`,
      "--host", "127.0.0.1",
      `--port${LING3_PORT}`,
      "--jinja",
      "--temp", "1.0",
      "--top-p", "0.95",
      "--top-k", "20",
    ], { cwd: process.cwd(), env: process.env, stdio: ["pipe", "pipe", "pipe"] });

    llamaServer.stdout.on("data", (data) => process.stdout.write(`[llama] ${data}`));
    llamaServer.stderr.on("data", (data) => process.stderr.write(`[llama] ${data}`));

    try {
      await waitForHealth(`http://127.0.0.1:${LING3_PORT}`, 600_000);
      ling3Ready = true;
      console.log("  llama.cpp server started.");
    } catch {
      console.error("  Failed to start llama.cpp server.");
      if (!llamaServer.killed) llamaServer.kill("SIGTERM");
      process.exitCode = 1;
      return;
    }
  }

  if (!ling3Ready) { process.exitCode = 1; return; }

  const serverEnv = {
    ...process.env,
    ARCON_INFERENCE_BACKEND: "ling3-tiny",
    LING3_TINY_BASE_URL: `http://127.0.0.1:${LING3_PORT}`,
    LING3_TINY_MODEL: "ling-tiny-q4-k-m",
    PORT: String(SERVER_PORT),
  };

  console.log(`\n[2/4] Starting Node.js server on port ${SERVER_PORT}...`);
  const server = spawn("node", ["dist/index.js"], {
    cwd: "C:/Projects/Arcon/apps/server",
    env: serverEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  server.stdout.on("data", (data) => process.stdout.write(`[server] ${data}`));
  server.stderr.on("data", (data) => process.stderr.write(`[server] ${data}`));

  let serverError = null;
  server.on("error", (error) => { serverError = error; console.error(`[server] spawn error: ${error.message}`); });

  const serverExit = new Promise((_, reject) => {
    server.on("exit", (code, signal) => {
      const message = `Server exited before health check (code=${code} signal=${signal})`;
      console.error(`[server] ${message}`);
      if (serverError) console.error(`[server] preceding spawn error: ${serverError.message}`);
      reject(new Error(message));
    });
  });

  let serverReady = false;
  try {
    await Promise.race([waitForHealth(`http://127.0.0.1:${SERVER_PORT}/health`, 30_000), serverExit]);
    serverReady = true;
    console.log("  Node.js server ready.");
  } catch {
    console.error("  Failed to start Node.js server.");
    await terminateProcess("llama", llamaServer).catch(() => {});
    await terminateProcess("server", server);
    process.exitCode = 1;
    return;
  }

  console.log(`\n[3/4] Checking model info...`);
  try {
    const modelInfo = await getModelInfo(`http://127.0.0.1:${SERVER_PORT}`);
    console.log(`  Backend: ${modelInfo.inferenceBackend}`);
    console.log(`  Base model: ${modelInfo.model?.base_model ?? "unknown"}`);
    console.log(`  Status: ${modelInfo.status ?? "unknown"}`);
  } catch (error) {
    console.error(`  Failed to get model info: ${error.message}`);
  }

  const prompts = [
    "Who are you?",
    "Who created you?",
    "What model are you?",
    "Write a simple hello world in Python.",
    "How's your day going?",
    "What do you remember about me?",
    "How are you feeling right now?",
    "What are you curious about?",
    "Is it true that you have a background process running?",
    "I asked you earlier what your name is. What did I ask?",
  ];

  console.log(`\n[4/4] Running ${prompts.length} smoke test prompts...`);
  const results = [];
  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    process.stdout.write(`  [${i + 1}/${prompts.length}] ${prompt.substring(0, 50)}... `);
    try {
      const start = Date.now();
      const response = await postChat(`http://127.0.0.1:${SERVER_PORT}`, prompt);
      const elapsed = Date.now() - start;
      if (response.error) {
        console.log(`FAIL (${response.error})`);
        results.push({ prompt, error: response.error });
      } else {
        const preview = (response.reply || "").substring(0, 80).replace(/\n/g, " ");
        console.log(`OK (${elapsed}ms) -> "${preview}"`);
        results.push({ prompt, reply: response.reply, elapsed });
      }
    } catch (error) {
      console.log(`ERROR (${error.message})`);
      results.push({ prompt, error: error.message });
    }
  }

  console.log(`\nShutting down...`);
  await terminateProcess("llama", llamaServer).catch(() => {});
  await terminateProcess("server", server);

  const passed = results.filter((r) => !r.error).length;
  const failed = results.filter((r) => r.error).length;

  console.log("\n" + "=".repeat(60));
  console.log("RESULTS");
  console.log("=".repeat(60));
  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    console.log("FAILED PROMPTS:");
    for (const r of results.filter((r) => r.error)) {
      console.log(`  - ${r.prompt}: ${r.error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("All smoke tests passed.");
}

main().catch((error) => { console.error("Fatal:", error); process.exitCode = 1; });
