import { spawnSync, type ChildProcess } from "node:child_process";

export function pidAlive(pid: number | null | undefined): boolean {
  if (pid == null || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 按 pid 结束进程树（Windows taskkill /T）。 */
export function killPidTree(pid: number | null | undefined): void {
  if (pid == null || pid <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

/** 结束子进程及其后代（Windows 上 LlamaFactory 常有孙进程占 GPU）。 */
export function killProcessTree(child: ChildProcess): void {
  killPidTree(child.pid);
}
