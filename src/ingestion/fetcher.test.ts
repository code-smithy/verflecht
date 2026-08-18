import { describe, expect, it } from "vitest";

import { FetchTimeoutError, HostRateLimiter, UrlFetcher, type FetchLike } from "./fetcher";
import { RobotsBlockedError } from "./robots";

function textResponse(body: string, init: ResponseInit & { url?: string } = {}): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", {
    value: init.url ?? "",
  });
  return response;
}

describe("URL fetcher", () => {
  it("follows redirects and records the final canonical URL", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url === "https://example.com/old") {
        return textResponse("", {
          status: 302,
          headers: { location: "/new?utm_source=test" },
          url,
        });
      }

      return textResponse("<html>public</html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        url,
      });
    };

    const fetcher = new UrlFetcher({ fetchImpl, respectRobots: false, requestsPerMinute: 0 });
    const result = await fetcher.fetch("https://example.com/old");

    expect(result.finalUrl).toBe("https://example.com/new");
    expect(result.redirectChain).toEqual(["https://example.com/new"]);
    expect(result.contentType).toBe("text/html; charset=utf-8");
    expect(result.accessStatus).toBe("PUBLIC");
    expect(result.extractionStatus).toBe("PENDING");
  });

  it("retries retryable HTTP failures", async () => {
    let attempts = 0;
    const retryDelays: number[] = [];
    const fetchImpl: FetchLike = async (url) => {
      attempts += 1;
      return attempts === 1
        ? textResponse("temporary outage", { status: 503, url })
        : textResponse("ok", { status: 200, url });
    };
    const fetcher = new UrlFetcher({
      fetchImpl,
      respectRobots: false,
      maxRetries: 1,
      retryDelayMs: 25,
      requestsPerMinute: 0,
      sleep: async (ms) => {
        retryDelays.push(ms);
      },
    });

    const result = await fetcher.fetch("https://example.com/story");

    expect(result.httpStatus).toBe(200);
    expect(attempts).toBe(2);
    expect(retryDelays).toEqual([25]);
  });

  it("times out stalled requests", async () => {
    const fetchImpl: FetchLike = (url, init) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error(`Aborted ${url}`), { name: "AbortError" }));
        });
      });
    const fetcher = new UrlFetcher({
      fetchImpl,
      respectRobots: false,
      maxRetries: 0,
      timeoutMs: 1,
      requestsPerMinute: 0,
    });

    await expect(fetcher.fetch("https://example.com/slow")).rejects.toThrow(FetchTimeoutError);
  });

  it("respects robots.txt disallow rules", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      requestedUrls.push(url);

      if (url === "https://example.com/robots.txt") {
        return textResponse("User-agent: *\nDisallow: /private", { status: 200, url });
      }

      return textResponse("should not fetch", { status: 200, url });
    };
    const fetcher = new UrlFetcher({
      fetchImpl,
      userAgent: "VerflechtResearchBot",
      maxRetries: 0,
      requestsPerMinute: 0,
    });

    await expect(fetcher.fetch("https://example.com/private/story")).rejects.toThrow(
      RobotsBlockedError,
    );
    expect(requestedUrls).toEqual(["https://example.com/robots.txt"]);
  });

  it("maps paywall markers without trying to bypass access controls", async () => {
    const fetchImpl: FetchLike = async (url) =>
      textResponse("<title>Article</title><p>Subscribe to continue reading.</p>", {
        status: 200,
        headers: { "content-type": "text/html" },
        url,
      });
    const fetcher = new UrlFetcher({ fetchImpl, respectRobots: false, requestsPerMinute: 0 });

    const result = await fetcher.fetch("https://example.com/paywalled");

    expect(result.accessStatus).toBe("PAYWALLED");
    expect(result.extractionStatus).toBe("PARTIAL");
  });
});

describe("host rate limiter", () => {
  it("waits between requests to the same host", async () => {
    let now = 1_000;
    const waits: number[] = [];
    const limiter = new HostRateLimiter({
      requestsPerMinute: 60,
      clock: () => now,
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      },
    });

    await limiter.wait("https://example.com/one");
    await limiter.wait("https://example.com/two");
    await limiter.wait("https://other.example/one");

    expect(waits).toEqual([1_000]);
  });
});
