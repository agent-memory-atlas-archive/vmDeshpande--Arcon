import os from "node:os";
import type { Tool, ToolContext, ToolResult } from "./tool.js";

export interface GetSystemStatusToolOptions {}

export function createGetSystemStatusTool(_options: GetSystemStatusToolOptions): Tool {
  return {
    name: "get_system_status",
    description: "Returns safe read-only system information: CPU, RAM, disk, OS, hostname. Does not expose secrets.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    async execute(_input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const hostname = os.hostname();
      const platform = os.platform();
      const release = os.release();
      const arch = os.arch();
      const loadAvg = os.loadavg();
      const uptime = os.uptime();

      const cpuUsage = cpus.length > 0 ? cpus.map((cpu) => ({
        model: cpu.model,
        speed: cpu.speed,
        times: {
          user: cpu.times.user,
          nice: cpu.times.nice,
          sys: cpu.times.sys,
          idle: cpu.times.idle,
          irq: cpu.times.irq,
        },
      })) : [];

      const diskInfo = getDiskInfo();

      return {
        success: true,
        toolName: "get_system_status",
        status: "success",
        output: {
          hostname,
          platform,
          osRelease: release,
          architecture: arch,
          uptimeSeconds: Math.floor(uptime),
          cpuCount: cpus.length,
          cpuUsage,
          loadAverage: {
            "1min": loadAvg[0],
            "5min": loadAvg[1],
            "15min": loadAvg[2],
          },
          memory: {
            totalBytes: totalMem,
            freeBytes: freeMem,
            usedBytes: usedMem,
            freeMB: Math.round(freeMem / 1024 / 1024),
            totalMB: Math.round(totalMem / 1024 / 1024),
            usedMB: Math.round(usedMem / 1024 / 1024),
            usagePercent: Math.round((usedMem / totalMem) * 1000) / 10,
          },
          disk: diskInfo,
          networkInterfaces: Object.entries(os.networkInterfaces()).map(([name, interfaces]) => ({
            name,
            addressCount: interfaces?.length ?? 0,
            addresses: (interfaces ?? []).map((iface) => ({
              family: iface.family,
              address: iface.address,
              internal: iface.internal,
            })),
          })),
        },
        durationMs: 0,
      };
    },
  };
}

function getDiskInfo() {
  try {
    const { statvfsSync } = require("node:fs");
    const rootStat = statvfsSync("/");
    return {
      totalBytes: rootStat.blocks * rootStat.bsize,
      freeBytes: rootStat.bfree * rootStat.bsize,
      availableBytes: rootStat.bavail * rootStat.bsize,
      totalGB: Math.round((rootStat.blocks * rootStat.bsize) / 1024 / 1024 / 1024),
      freeGB: Math.round((rootStat.bfree * rootStat.bsize) / 1024 / 1024 / 1024),
    };
  } catch {
    try {
      const fs = require("node:fs");
      const rootStat = fs.statSync("C:\\");
      return {
        totalBytes: rootStat.size,
        freeBytes: rootStat.availSize,
        availableBytes: rootStat.availSize,
        totalGB: Math.round(rootStat.size / 1024 / 1024 / 1024),
        freeGB: Math.round(rootStat.availSize / 1024 / 1024 / 1024),
      };
    } catch {
      return { note: "Disk information not available on this platform" };
    }
  }
}
