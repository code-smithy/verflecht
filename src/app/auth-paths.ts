const defaultSiteBasePath = "/verflecht";

export function getSafeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("://")) {
    return "/app";
  }

  return value.startsWith("/app") ? value : "/app";
}

export function buildSiteUrl(
  origin: string,
  pathWithQuery: string,
  basePath = process.env.NEXT_PUBLIC_SITE_BASE_PATH ?? defaultSiteBasePath,
): string {
  const { path, suffix } = splitPathAndSuffix(pathWithQuery);
  const normalizedBasePath = normalizeBasePath(basePath);
  const normalizedPath = withTrailingSlash(path.startsWith("/") ? path : `/${path}`);

  return new URL(`${normalizedBasePath}${normalizedPath}${suffix}`, origin).toString();
}

function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.trim();

  if (!trimmed || trimmed === "/") {
    return "";
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function withTrailingSlash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

function splitPathAndSuffix(pathWithQuery: string): { path: string; suffix: string } {
  const match = pathWithQuery.match(/^([^?#]*)([?#].*)?$/);

  return {
    path: match?.[1] || "/",
    suffix: match?.[2] ?? "",
  };
}
