import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { patchSwanlabCloudKey, stripSwanlabLogdirRunnerPatch } from "../llamaFactoryCompat.js";

describe("llamaFactoryCompat", () => {
  it("patches hard cloud key access idempotently", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mt-lf-compat-"));
    const file = path.join(home, "src", "llamafactory", "webui", "control.py");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        "    if os.path.isfile(swanlab_config_path):",
        "        with open(swanlab_config_path, encoding=\"utf-8\") as f:",
        "            swanlab_public_config = json.load(f)",
        '            swanlab_link = swanlab_public_config["cloud"]["experiment_url"]',
        "            if swanlab_link is not None:",
        "                pass",
        "",
      ].join("\n"),
      "utf8",
    );
    expect(patchSwanlabCloudKey(home)).toBe(true);
    const once = fs.readFileSync(file, "utf8");
    expect(once).toContain("mtrain-compat:swanlab-cloud");
    expect(once).toContain('.get("cloud")');
    expect(patchSwanlabCloudKey(home)).toBe(false);
  });

  it("strips SWANLAB_LOGDIR runner injection", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mt-lf-runner-"));
    const file = path.join(home, "src", "llamafactory", "webui", "runner.py");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        '            args["swanlab_mode"] = get("train.swanlab_mode")',
        "            # WebUI 未暴露 logdir；本仓库通过 SWANLAB_LOGDIR 对齐 outputs/swanlog",
        '            env_logdir = (os.environ.get("SWANLAB_LOGDIR") or "").strip()',
        "            if env_logdir:",
        '                args["swanlab_logdir"] = env_logdir',
        "",
        "        # eval config",
        "",
      ].join("\n"),
      "utf8",
    );
    expect(stripSwanlabLogdirRunnerPatch(home)).toBe(true);
    const text = fs.readFileSync(file, "utf8");
    expect(text).not.toContain("SWANLAB_LOGDIR");
    expect(text).toContain('args["swanlab_mode"] = get("train.swanlab_mode")');
    expect(stripSwanlabLogdirRunnerPatch(home)).toBe(false);
  });
});
