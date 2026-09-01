import { describe, expect, it } from "vitest";
import { shouldPollJobs } from "../jobs/poll";

describe("shouldPollJobs", () => {
  it("polls only while a job is running", () => {
    expect(shouldPollJobs(true)).toBe(true);
    expect(shouldPollJobs(false)).toBe(false);
  });
});
