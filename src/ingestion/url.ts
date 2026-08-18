const TRACKING_QUERY_PARAMS = new Set(["fbclid", "gclid", "mc_cid", "mc_eid", "msclkid"]);

export type CanonicalizeUrlOptions = {
  preserveLanguageVariant?: boolean;
};

function assertHttpUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs can be ingested.");
  }
}

function normalizePathname(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0]?.toLowerCase() === "amp") {
    segments.shift();
  }

  if (segments[segments.length - 1]?.toLowerCase() === "amp") {
    segments.pop();
  }

  if (segments[0]?.toLowerCase() === "print") {
    segments.shift();
  }

  if (segments[segments.length - 1]?.toLowerCase() === "print") {
    segments.pop();
  }

  const normalizedSegments = segments.map((segment) =>
    segment.replace(/\.amp(\.[a-z0-9]+)$/i, "$1").replace(/\.print(\.[a-z0-9]+)$/i, "$1"),
  );

  const normalized = `/${normalizedSegments.join("/")}`;
  return normalized === "/" ? "/" : normalized.replace(/\/+$/u, "");
}

function shouldRemoveQueryParam(
  key: string,
  value: string,
  options: Required<CanonicalizeUrlOptions>,
): boolean {
  const normalizedKey = key.toLowerCase();
  const normalizedValue = value.toLowerCase();

  if (normalizedKey.startsWith("utm_") || TRACKING_QUERY_PARAMS.has(normalizedKey)) {
    return true;
  }

  if (normalizedKey === "amp" || normalizedKey === "amp_js_v" || normalizedKey === "usqp") {
    return true;
  }

  if (
    (normalizedKey === "print" || normalizedKey === "printable") &&
    (normalizedValue === "" || normalizedValue === "1" || normalizedValue === "true")
  ) {
    return true;
  }

  if (
    ["view", "output", "display", "format"].includes(normalizedKey) &&
    normalizedValue === "print"
  ) {
    return true;
  }

  if (!options.preserveLanguageVariant && ["lang", "language", "locale"].includes(normalizedKey)) {
    return true;
  }

  return false;
}

function normalizeSearchParams(url: URL, options: Required<CanonicalizeUrlOptions>): void {
  const entries = Array.from(url.searchParams.entries())
    .filter(([key, value]) => !shouldRemoveQueryParam(key, value, options))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyComparison = leftKey.localeCompare(rightKey);
      return keyComparison === 0 ? leftValue.localeCompare(rightValue) : keyComparison;
    });

  url.search = "";
  for (const [key, value] of entries) {
    url.searchParams.append(key, value);
  }
}

export function canonicalizeUrl(input: string, options: CanonicalizeUrlOptions = {}): string {
  const resolvedOptions = {
    preserveLanguageVariant: options.preserveLanguageVariant ?? true,
  };
  const url = new URL(input.trim());

  assertHttpUrl(url);

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  url.pathname = normalizePathname(url.pathname);
  normalizeSearchParams(url, resolvedOptions);

  return url.toString();
}

export function resolveRedirectUrl(currentUrl: string, location: string): string {
  return canonicalizeUrl(new URL(location, currentUrl).toString());
}
