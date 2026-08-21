import { describe, expect, it } from "vitest";

import { buildSiteUrl, getSafeNextPath } from "./auth-paths";

describe("auth paths", () => {
  it("builds base-path aware callback URLs", () => {
    expect(buildSiteUrl("https://code-smithy.github.io", "/login/?next=%2Fapp", "/verflecht")).toBe(
      "https://code-smithy.github.io/verflecht/login/?next=%2Fapp",
    );
  });

  it("allows only internal app return paths", () => {
    expect(getSafeNextPath("/app/review?status=open")).toBe("/app/review?status=open");
    expect(getSafeNextPath("/people")).toBe("/app");
    expect(getSafeNextPath("https://example.com")).toBe("/app");
    expect(getSafeNextPath("//example.com")).toBe("/app");
  });
});
