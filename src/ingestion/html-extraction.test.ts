import { describe, expect, it } from "vitest";

import { InMemoryResearchRepository } from "../domain/repository";
import { ResearchDomainService } from "../domain/services";

import { extractHtmlDocument } from "./html-extraction";

describe("HTML extraction", () => {
  it("prefers JSON-LD article metadata over OpenGraph and HTML metadata", () => {
    const result = extractHtmlDocument(`
      <html lang="fr">
        <head>
          <title>HTML Title</title>
          <meta property="og:title" content="OpenGraph Title">
          <meta property="og:site_name" content="OG Publisher">
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "NewsArticle",
              "headline": "JSON-LD Headline",
              "author": { "name": "Jane Reporter" },
              "publisher": { "name": "Example Gazette" },
              "datePublished": "2026-08-17T09:30:00+02:00",
              "description": "Structured summary.",
              "inLanguage": "de-CH"
            }
          </script>
        </head>
        <body>
          <article>
            <h1>Visible headline</h1>
            <p>First public paragraph.</p>
          </article>
        </body>
      </html>
    `);

    expect(result).toMatchObject({
      title: "JSON-LD Headline",
      author: "Jane Reporter",
      publisher: "Example Gazette",
      description: "Structured summary.",
      bodyText: "Visible headline First public paragraph.",
      language: "de-CH",
      extractionStatus: "SUCCESS",
    });
    expect(result.publishedAt?.toISOString()).toBe("2026-08-17T07:30:00.000Z");
    expect(result.metadata).toMatchObject({
      htmlExtraction: {
        fieldSources: {
          title: "jsonLd",
          author: "jsonLd",
          publisher: "jsonLd",
          bodyText: "visibleContent",
        },
      },
    });
  });

  it("uses OpenGraph metadata when structured JSON-LD is absent", () => {
    const result = extractHtmlDocument(`
      <html>
        <head>
          <title>Fallback HTML Title</title>
          <meta property="og:title" content="OpenGraph Title">
          <meta property="og:description" content="OpenGraph summary">
          <meta property="article:published_time" content="2026-08-16">
          <meta property="og:site_name" content="Example News">
        </head>
        <body><main><p>OpenGraph fallback body.</p></main></body>
      </html>
    `);

    expect(result).toMatchObject({
      title: "OpenGraph Title",
      publisher: "Example News",
      description: "OpenGraph summary",
      bodyText: "OpenGraph fallback body.",
      extractionStatus: "SUCCESS",
    });
    expect(result.metadata).toMatchObject({
      htmlExtraction: { fieldSources: { title: "openGraph" } },
    });
  });

  it("prefers Schema.org itemprop metadata before OpenGraph metadata", () => {
    const result = extractHtmlDocument(`
      <html>
        <head>
          <meta itemprop="headline" content="Schema Headline">
          <meta itemprop="author" content="Schema Author">
          <meta property="og:title" content="OpenGraph Title">
        </head>
        <body><article><p>Schema fallback body.</p></article></body>
      </html>
    `);

    expect(result).toMatchObject({
      title: "Schema Headline",
      author: "Schema Author",
      bodyText: "Schema fallback body.",
      extractionStatus: "SUCCESS",
    });
    expect(result.metadata).toMatchObject({
      htmlExtraction: { fieldSources: { title: "schemaOrg" } },
    });
  });

  it("falls back to deterministic visible-content extraction", () => {
    const result = extractHtmlDocument(`
      <html lang="it">
        <body>
          <header>Navigation should disappear</header>
          <main>
            <h1>Report Title</h1>
            <p>Alpha&nbsp;paragraph.</p>
            <p>Beta &amp; gamma paragraph.</p>
          </main>
          <footer>Footer should disappear</footer>
        </body>
      </html>
    `);

    expect(result).toMatchObject({
      title: "Report Title",
      bodyText: "Report Title Alpha paragraph. Beta & gamma paragraph.",
      language: "it",
      extractionStatus: "SUCCESS",
    });
    expect(result.metadata).toMatchObject({
      htmlExtraction: { fieldSources: { title: "visibleContent" } },
    });
  });

  it("marks metadata-only and failed extraction states explicitly", () => {
    expect(
      extractHtmlDocument(`
        <html>
          <body><main><p>Body without a title.</p></main></body>
        </html>
      `),
    ).toMatchObject({
      bodyText: "Body without a title.",
      extractionStatus: "PARTIAL",
    });

    expect(
      extractHtmlDocument(`
        <html>
          <head><meta name="description" content="Only metadata"></head>
          <body><script>const hidden = true;</script></body>
        </html>
      `),
    ).toMatchObject({
      description: "Only metadata",
      bodyText: undefined,
      extractionStatus: "METADATA_ONLY",
    });

    expect(
      extractHtmlDocument(`
        <html>
          <head><script>const hidden = true;</script></head>
          <body><style>.hidden { display: none; }</style></body>
        </html>
      `),
    ).toMatchObject({
      extractionStatus: "FAILED",
    });
  });

  it("writes extraction output back to the document record", () => {
    let id = 0;
    const repository = new InMemoryResearchRepository();
    const service = new ResearchDomainService(repository, {
      clock: () => new Date("2026-08-18T10:00:00.000Z"),
      idFactory: () => `id-${++id}`,
    });
    const source = service.createSource({
      name: "Example News",
      sourceType: "NEWS_ARTICLE",
      sourceQuality: "D",
      enabled: true,
      metadata: {},
    });
    const document = service.createDocument({
      sourceId: source.id,
      originalUrl: "https://example.com/story",
      accessStatus: "PUBLIC",
      extractionStatus: "PENDING",
      metadata: { documentVersion: 1 },
    });
    const extraction = extractHtmlDocument(`
      <html>
        <head><title>Stored Title</title></head>
        <body><article><p>Stored body.</p></article></body>
      </html>
    `);

    const updated = service.updateDocumentExtraction(document.id, {
      title: extraction.title,
      author: extraction.author,
      publisher: extraction.publisher,
      publishedAt: extraction.publishedAt,
      description: extraction.description,
      language: extraction.language,
      extractedText: extraction.bodyText,
      extractionStatus: extraction.extractionStatus,
      metadata: extraction.metadata,
    });

    expect(updated).toMatchObject({
      title: "Stored Title",
      extractedText: "Stored body.",
      extractionStatus: "SUCCESS",
      metadata: {
        documentVersion: 1,
        htmlExtraction: expect.any(Object),
      },
    });
  });
});
