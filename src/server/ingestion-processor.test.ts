import { describe, expect, it } from "vitest";

import { nextRetryAt } from "./ingestion-processor";

describe("ingestion processor", () => {
  it("uses bounded exponential retry delays for fetch jobs", () => {
    const now = new Date("2026-08-21T10:00:00.000Z");

    expect(nextRetryAt(now, 1).toISOString()).toBe("2026-08-21T10:01:00.000Z");
    expect(nextRetryAt(now, 2).toISOString()).toBe("2026-08-21T10:02:00.000Z");
    expect(nextRetryAt(now, 8).toISOString()).toBe("2026-08-21T11:00:00.000Z");
  });
});
