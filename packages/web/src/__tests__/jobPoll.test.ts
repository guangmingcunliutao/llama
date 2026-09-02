import { describe, expect, it } from "vitest";
import { jobPollIntervalMs, shouldPollJobs } from "../jobs/poll";
import { focusJob, type JobSnapshot } from "../jobs/focus";

describe("shouldPollJobs", () => {
  it("polls only while a job is running and the tab is visible", () => {
    expect(shouldPollJobs(true, false)).toBe(true);
    expect(shouldPollJobs(true, true)).toBe(false);
    expect(shouldPollJobs(false, false)).toBe(false);
  });
});

describe("jobPollIntervalMs", () => {
  it("pauses while hidden", () => {
    expect(jobPollIntervalMs(true)).toBeNull();
    expect(jobPollIntervalMs(false)).toBeGreaterThanOrEqual(5000);
  });
});

describe("focusJob", () => {
  const snap: JobSnapshot = {
    ok: true,
    job: "generate",
    running: ["generate", "train"],
    busy: true,
    logs: ["all"],
    lastCode: null,
    error: null,
    jobs: {
      generate: { name: "generate", busy: true, logs: ["g"], lastCode: null, error: null },
      train: { name: "train", busy: true, logs: ["t"], lastCode: null, error: null },
    },
  };

  it("narrows logs to the page's jobs", () => {
    const train = focusJob(snap, "train");
    expect(train.busy).toBe(true);
    expect(train.job).toBe("train");
    expect(train.logs).toEqual(["t"]);
  });
});
