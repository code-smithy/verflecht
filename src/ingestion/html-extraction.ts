import type { ExtractionStatus } from "../domain/ontology";
import type { JsonRecord } from "../domain/records";

export type HtmlExtractionResult = {
  title?: string;
  author?: string;
  publisher?: string;
  publishedAt?: Date;
  description?: string;
  bodyText?: string;
  language?: string;
  extractionStatus: ExtractionStatus;
  metadata: JsonRecord;
};

type FieldName = Exclude<keyof HtmlExtractionResult, "extractionStatus" | "metadata">;
type FieldSource = "jsonLd" | "schemaOrg" | "openGraph" | "html" | "visibleContent";
type FieldValues = Partial<Record<FieldName, string>>;
type FieldSources = Partial<Record<FieldName, FieldSource>>;

type JsonLdObject = Record<string, unknown>;
type HtmlMetadata = {
  byName: Map<string, string>;
  byProperty: Map<string, string>;
  byItemprop: Map<string, string>;
};

const FIELD_ORDER: FieldSource[] = ["jsonLd", "schemaOrg", "openGraph", "html", "visibleContent"];

function decodeHtmlEntity(entity: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  if (entity.startsWith("#x") || entity.startsWith("#X")) {
    const parsed = Number.parseInt(entity.slice(2), 16);
    return Number.isNaN(parsed) ? `&${entity};` : String.fromCodePoint(parsed);
  }

  if (entity.startsWith("#")) {
    const parsed = Number.parseInt(entity.slice(1), 10);
    return Number.isNaN(parsed) ? `&${entity};` : String.fromCodePoint(parsed);
  }

  return namedEntities[entity] ?? `&${entity};`;
}

function decodeHtml(value: string): string {
  return value.replace(/&([a-zA-Z][a-zA-Z0-9]+|#[0-9]+|#x[0-9a-fA-F]+);/gu, (_, entity) =>
    decodeHtmlEntity(String(entity)),
  );
}

function normalizeText(value?: string): string | undefined {
  const normalized = decodeHtml(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();

  return normalized.length > 0 ? normalized : undefined;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/gu, " ");
}

function getAttribute(tag: string, attributeName: string): string | undefined {
  const pattern = new RegExp(
    `\\s${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + "`" + `]+))`,
    "iu",
  );
  const match = tag.match(pattern);
  return normalizeText(match?.[1] ?? match?.[2] ?? match?.[3]);
}

function findFirstTag(html: string, tagName: string): string | undefined {
  return html.match(new RegExp(`<${tagName}\\b[^>]*>`, "iu"))?.[0];
}

function findElementText(html: string, tagName: string): string | undefined {
  const match = html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "iu"));
  return match ? normalizeText(stripTags(match[1] ?? "")) : undefined;
}

function collectMeta(html: string): HtmlMetadata {
  const meta: HtmlMetadata = {
    byName: new Map<string, string>(),
    byProperty: new Map<string, string>(),
    byItemprop: new Map<string, string>(),
  };

  for (const match of html.matchAll(/<meta\b[^>]*>/giu)) {
    const tag = match[0];
    const content = getAttribute(tag, "content");

    if (!content) {
      continue;
    }

    const property = getAttribute(tag, "property");
    const name = getAttribute(tag, "name");
    const itemprop = getAttribute(tag, "itemprop");

    if (property) {
      meta.byProperty.set(property.toLowerCase(), content);
    }

    if (name) {
      meta.byName.set(name.toLowerCase(), content);
    }

    if (itemprop) {
      meta.byItemprop.set(itemprop.toLowerCase(), content);
    }
  }

  return meta;
}

function parseDate(value?: string): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function normalizeLanguage(value?: string): string | undefined {
  const normalized = normalizeText(value)?.replace("_", "-");

  if (!normalized) {
    return undefined;
  }

  const [language, region] = normalized.split("-");

  if (!language || !/^[a-z]{2}$/iu.test(language)) {
    return undefined;
  }

  return region && /^[a-z]{2}$/iu.test(region)
    ? `${language.toLowerCase()}-${region.toUpperCase()}`
    : language.toLowerCase();
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return normalizeText(value);
  }

  if (typeof value === "number") {
    return String(value);
  }

  return undefined;
}

function namedValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value.map(namedValue).find((candidate): candidate is string => Boolean(candidate));
  }

  if (value && typeof value === "object") {
    const record = value as JsonLdObject;
    return asString(record.name) ?? asString(record.headline);
  }

  return asString(value);
}

function jsonLdTypeMatches(value: unknown): boolean {
  const types = Array.isArray(value) ? value : [value];

  return types.some((type) => {
    const normalized = asString(type)?.toLowerCase();
    return normalized
      ? ["article", "newsarticle", "report", "webpage", "blogposting"].includes(normalized)
      : false;
  });
}

function flattenJsonLd(value: unknown): JsonLdObject[] {
  if (Array.isArray(value)) {
    return value.flatMap(flattenJsonLd);
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const object = value as JsonLdObject;
  const nestedGraph = flattenJsonLd(object["@graph"]);

  return [object, ...nestedGraph];
}

function collectJsonLd(html: string): FieldValues {
  const values: FieldValues = {};

  for (const match of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu,
  )) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1] ?? ""));
      const candidates = flattenJsonLd(parsed);
      const article =
        candidates.find((candidate) => jsonLdTypeMatches(candidate["@type"])) ?? candidates[0];

      if (!article) {
        continue;
      }

      values.title ??= asString(article.headline) ?? asString(article.name);
      values.author ??= namedValue(article.author);
      values.publisher ??= namedValue(article.publisher);
      values.publishedAt ??= asString(article.datePublished) ?? asString(article.dateCreated);
      values.description ??= asString(article.description);
      values.language ??= normalizeLanguage(asString(article.inLanguage));
    } catch {
      continue;
    }
  }

  return values;
}

function collectSchemaOrg(html: string, meta: HtmlMetadata): FieldValues {
  const values: FieldValues = {
    title: meta.byItemprop.get("headline") ?? meta.byItemprop.get("name"),
    author: meta.byItemprop.get("author"),
    publisher: meta.byItemprop.get("publisher"),
    publishedAt: meta.byItemprop.get("datepublished") ?? meta.byItemprop.get("datecreated"),
    description: meta.byItemprop.get("description"),
    language: normalizeLanguage(meta.byItemprop.get("inlanguage")),
  };

  for (const match of html.matchAll(/<time\b[^>]*itemprop\s*=\s*["']datePublished["'][^>]*>/giu)) {
    values.publishedAt ??= getAttribute(match[0], "datetime");
  }

  return values;
}

function collectOpenGraph(meta: HtmlMetadata): FieldValues {
  return {
    title: meta.byProperty.get("og:title") ?? meta.byName.get("twitter:title"),
    author: meta.byProperty.get("article:author"),
    publisher: meta.byProperty.get("og:site_name"),
    publishedAt: meta.byProperty.get("article:published_time"),
    description: meta.byProperty.get("og:description") ?? meta.byName.get("twitter:description"),
    language: normalizeLanguage(meta.byProperty.get("og:locale")),
  };
}

function collectHtml(html: string, meta: HtmlMetadata): FieldValues {
  const htmlTag = findFirstTag(html, "html");

  return {
    title: findElementText(html, "title"),
    author: meta.byName.get("author"),
    publisher: meta.byName.get("publisher") ?? meta.byName.get("application-name"),
    publishedAt:
      meta.byName.get("date") ?? meta.byName.get("dc.date") ?? meta.byName.get("dc.date.issued"),
    description: meta.byName.get("description"),
    language: normalizeLanguage(htmlTag ? getAttribute(htmlTag, "lang") : undefined),
  };
}

function stripInvisibleContent(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/giu, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/giu, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/giu, " ")
    .replace(/<header\b[\s\S]*?<\/header>/giu, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/giu, " ");
}

function selectBodyHtml(html: string): string {
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/iu)?.[1];
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/iu)?.[1];
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/iu)?.[1];

  return article ?? main ?? body ?? html;
}

function extractVisibleText(html: string): string | undefined {
  return normalizeText(
    stripTags(
      stripInvisibleContent(selectBodyHtml(html))
        .replace(/<\/(p|div|section|article|h[1-6]|li|tr)>/giu, "\n")
        .replace(/<br\s*\/?>/giu, "\n"),
    ),
  );
}

function collectVisibleContent(html: string): FieldValues {
  const selected = selectBodyHtml(html);

  return {
    title: findElementText(selected, "h1"),
    bodyText: extractVisibleText(html),
  };
}

function assignFields(
  values: FieldValues,
  source: FieldSource,
  fields: FieldValues,
  sources: FieldSources,
): void {
  for (const [field, value] of Object.entries(fields) as [FieldName, string | undefined][]) {
    const normalized = field === "language" ? normalizeLanguage(value) : normalizeText(value);

    if (!values[field] && normalized) {
      values[field] = normalized;
      sources[field] = source;
    }
  }
}

function statusFor(values: FieldValues): ExtractionStatus {
  const hasMetadata = Boolean(
    values.title ||
    values.author ||
    values.publisher ||
    values.publishedAt ||
    values.description ||
    values.language,
  );
  const hasBody = Boolean(values.bodyText);

  if (!hasMetadata && !hasBody) {
    return "FAILED";
  }

  if (!hasBody) {
    return "METADATA_ONLY";
  }

  return values.title ? "SUCCESS" : "PARTIAL";
}

export function extractHtmlDocument(html: string): HtmlExtractionResult {
  const meta = collectMeta(html);
  const values: FieldValues = {};
  const sources: FieldSources = {};

  const sourceValues: Record<FieldSource, FieldValues> = {
    jsonLd: collectJsonLd(html),
    schemaOrg: collectSchemaOrg(html, meta),
    openGraph: collectOpenGraph(meta),
    html: collectHtml(html, meta),
    visibleContent: collectVisibleContent(html),
  };

  for (const source of FIELD_ORDER) {
    assignFields(values, source, sourceValues[source], sources);
  }

  const extractionStatus = statusFor(values);

  return {
    title: values.title,
    author: values.author,
    publisher: values.publisher,
    publishedAt: parseDate(values.publishedAt),
    description: values.description,
    bodyText: values.bodyText,
    language: normalizeLanguage(values.language),
    extractionStatus,
    metadata: {
      htmlExtraction: {
        fieldSources: sources,
        ...(extractionStatus === "FAILED"
          ? { statusReason: "No usable metadata or visible body text was found." }
          : {}),
      },
    },
  };
}
