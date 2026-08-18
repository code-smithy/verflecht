import type { AccessStatus, ExtractionStatus } from "../domain/ontology";

import { canonicalizeUrl, resolveRedirectUrl } from "./url";
import { isRobotsAllowed, RobotsBlockedError } from "./robots";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type UrlFetcherOptions = {
  fetchImpl?: FetchLike;
  userAgent?: string;
  timeoutMs?: number;
  maxRetries?: number;
  maxRedirects?: number;
  retryDelayMs?: number;
  requestsPerMinute?: number;
  respectRobots?: boolean;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type UrlFetchResult = {
  originalUrl: string;
  finalUrl: string;
  redirectChain: string[];
  httpStatus: number;
  contentType?: string;
  body: Uint8Array;
  accessStatus: AccessStatus;
  extractionStatus: ExtractionStatus;
  headers: Record<string, string>;
};

export class FetchTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Fetching ${url} timed out after ${timeoutMs}ms.`);
    this.name = "FetchTimeoutError";
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return record;
}

function inferAccessStatus(
  status: number,
  bodyText: string,
  headers: Record<string, string>,
): AccessStatus {
  const lowerBody = bodyText.toLowerCase();
  const paywallHeader = headers["x-paywall"]?.toLowerCase();

  if (status === 401) {
    return "LOGIN_REQUIRED";
  }

  if (status === 402 || paywallHeader === "true") {
    return "PAYWALLED";
  }

  if (status === 403 || status === 451) {
    return "BLOCKED";
  }

  if (status === 404 || status === 410) {
    return "REMOVED";
  }

  if (
    lowerBody.includes("subscribe to continue") ||
    lowerBody.includes("subscriber-only") ||
    lowerBody.includes("paywall")
  ) {
    return "PAYWALLED";
  }

  if (status >= 200 && status <= 299) {
    return "PUBLIC";
  }

  return "UNKNOWN";
}

function inferExtractionStatus(
  accessStatus: AccessStatus,
  status: number,
  bodyLength: number,
): ExtractionStatus {
  if (accessStatus === "PAYWALLED") {
    return bodyLength > 0 ? "PARTIAL" : "METADATA_ONLY";
  }

  if (status >= 200 && status <= 299) {
    return "PENDING";
  }

  return "FAILED";
}

export class HostRateLimiter {
  private readonly nextFetchAtByHost = new Map<string, number>();
  private readonly requestsPerMinute: number;
  private readonly clock: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: Pick<UrlFetcherOptions, "requestsPerMinute" | "clock" | "sleep"> = {}) {
    this.requestsPerMinute = options.requestsPerMinute ?? 10;
    this.clock = options.clock ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async wait(url: string): Promise<void> {
    if (this.requestsPerMinute <= 0) {
      return;
    }

    const host = new URL(url).host;
    const intervalMs = 60_000 / this.requestsPerMinute;
    const now = this.clock();
    const nextFetchAt = this.nextFetchAtByHost.get(host) ?? now;
    const waitMs = Math.max(0, nextFetchAt - now);
    this.nextFetchAtByHost.set(host, Math.max(now, nextFetchAt) + intervalMs);

    if (waitMs > 0) {
      await this.sleep(waitMs);
    }
  }
}

export class UrlFetcher {
  private readonly fetchImpl: FetchLike;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxRedirects: number;
  private readonly retryDelayMs: number;
  private readonly respectRobots: boolean;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly rateLimiter: HostRateLimiter;
  private readonly robotsCache = new Map<string, string | undefined>();

  constructor(options: UrlFetcherOptions = {}) {
    if (!options.fetchImpl && !globalThis.fetch) {
      throw new Error("No fetch implementation is available.");
    }

    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.userAgent = options.userAgent ?? "VerflechtResearchBot/0.1";
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.retryDelayMs = options.retryDelayMs ?? 250;
    this.respectRobots = options.respectRobots ?? true;
    this.sleep = options.sleep ?? defaultSleep;
    this.rateLimiter = new HostRateLimiter(options);
  }

  async fetch(url: string): Promise<UrlFetchResult> {
    const originalUrl = canonicalizeUrl(url);
    let currentUrl = originalUrl;
    const redirectChain: string[] = [];

    for (let redirectCount = 0; redirectCount <= this.maxRedirects; redirectCount += 1) {
      if (this.respectRobots) {
        await this.assertRobotsAllowed(currentUrl);
      }

      await this.rateLimiter.wait(currentUrl);
      const response = await this.fetchWithRetry(currentUrl);

      if (isRedirectStatus(response.status)) {
        const location = response.headers.get("location");

        if (!location) {
          throw new Error(
            `Redirect response from ${currentUrl} did not include a Location header.`,
          );
        }

        currentUrl = resolveRedirectUrl(currentUrl, location);
        redirectChain.push(currentUrl);
        continue;
      }

      const body = new Uint8Array(await response.arrayBuffer());
      const headers = headersToRecord(response.headers);
      const bodyText = new TextDecoder().decode(body);
      const accessStatus = inferAccessStatus(response.status, bodyText, headers);

      return {
        originalUrl,
        finalUrl: canonicalizeUrl(response.url || currentUrl),
        redirectChain,
        httpStatus: response.status,
        contentType: response.headers.get("content-type") ?? undefined,
        body,
        accessStatus,
        extractionStatus: inferExtractionStatus(accessStatus, response.status, body.byteLength),
        headers,
      };
    }

    throw new Error(`Too many redirects while fetching ${originalUrl}.`);
  }

  private async fetchWithRetry(url: string): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(url);

        if (isRetryableStatus(response.status) && attempt < this.maxRetries) {
          await this.sleep(this.retryDelayMs * (attempt + 1));
          continue;
        }

        return response;
      } catch (error) {
        lastError = error;

        if (attempt >= this.maxRetries) {
          break;
        }

        await this.sleep(this.retryDelayMs * (attempt + 1));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Fetching ${url} failed.`);
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(url, {
        headers: { "user-agent": this.userAgent },
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new FetchTimeoutError(url, this.timeoutMs);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async assertRobotsAllowed(url: string): Promise<void> {
    const parsedUrl = new URL(url);
    const robotsUrl = `${parsedUrl.protocol}//${parsedUrl.host}/robots.txt`;

    let robotsTxt = this.robotsCache.get(robotsUrl);

    if (!this.robotsCache.has(robotsUrl)) {
      try {
        const response = await this.fetchWithRetry(robotsUrl);
        robotsTxt = response.ok ? await response.text() : undefined;
      } catch {
        robotsTxt = undefined;
      }

      this.robotsCache.set(robotsUrl, robotsTxt);
    }

    if (
      robotsTxt &&
      !isRobotsAllowed(robotsTxt, `${parsedUrl.pathname}${parsedUrl.search}`, this.userAgent)
    ) {
      throw new RobotsBlockedError(url);
    }
  }
}
