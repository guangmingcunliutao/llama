import { describe, expect, it } from "vitest";
import { routeFromGlobKey } from "../menu/routeFromGlob";

describe("routeFromGlobKey", () => {
  it("maps pages files to routes without a hand-written path", () => {
    expect(routeFromGlobKey("../pages/index.tsx")).toBe("/");
    expect(routeFromGlobKey("../pages/data.tsx")).toBe("/data");
    expect(routeFromGlobKey("../pages/foo/bar.tsx")).toBe("/foo/bar");
    expect(routeFromGlobKey("../pages/foo/index.tsx")).toBe("/foo");
    expect(routeFromGlobKey("E:/llama/packages/web/src/pages/train.tsx")).toBe("/train");
  });
});
