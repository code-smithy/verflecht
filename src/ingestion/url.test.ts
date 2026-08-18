import { describe, expect, it } from "vitest";

import { canonicalizeUrl, resolveRedirectUrl } from "./url";

describe("URL canonicalization", () => {
  it("removes tracking parameters, fragments, and default ports", () => {
    expect(
      canonicalizeUrl(
        "HTTPS://Example.COM:443/news/story/?utm_source=newsletter&b=2&a=1&fbclid=abc#section",
      ),
    ).toBe("https://example.com/news/story?a=1&b=2");
  });

  it("normalizes common AMP and print URL variants", () => {
    expect(canonicalizeUrl("https://example.com/amp/news/story?amp=1")).toBe(
      "https://example.com/news/story",
    );
    expect(canonicalizeUrl("https://example.com/news/story/amp")).toBe(
      "https://example.com/news/story",
    );
    expect(canonicalizeUrl("https://example.com/news/story.print.html?view=print")).toBe(
      "https://example.com/news/story.html",
    );
  });

  it("preserves language variants by default", () => {
    expect(canonicalizeUrl("https://example.ch/article?lang=de&utm_medium=social")).toBe(
      "https://example.ch/article?lang=de",
    );
  });

  it("resolves relative redirect locations before canonicalizing", () => {
    expect(resolveRedirectUrl("https://example.com/news/old", "../new?utm_campaign=x")).toBe(
      "https://example.com/new",
    );
  });
});
