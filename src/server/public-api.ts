import {
  connectionClasses,
  entityTypes,
  isConnectionClass,
  isEntityType,
  isRelationPredicate,
  relationPredicates,
  type ConnectionClass,
  type EntityType,
  type RelationPredicate,
} from "../domain/ontology";
import type {
  PublicClaimDetail,
  PublicEntityDetail,
  PublicGraphFilters,
  PublicGraphProjection,
  PublicGraphService,
} from "../domain/public-graph";

export type PublicApiReader = Pick<
  PublicGraphService,
  "getPublicGraph" | "getPublicEntityDetail" | "getPublicClaimDetail"
>;

type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export type PublicGraphHandlerResult =
  | { status: 200; body: PublicGraphProjection }
  | { status: 400; body: { error: string; details: string[] } };

export type PublicEntityHandlerResult =
  { status: 200; body: PublicEntityDetail } | { status: 404; body: { error: string } };

export type PublicClaimHandlerResult =
  { status: 200; body: PublicClaimDetail } | { status: 404; body: { error: string } };

export function parsePublicGraphFilters(
  searchParams: URLSearchParams,
): ParseResult<PublicGraphFilters> {
  const errors: string[] = [];
  const filters: PublicGraphFilters = {};

  const entityId = optionalParam(searchParams, "entity_id");
  if (entityId) {
    filters.entityId = entityId;
  }

  const entityType = optionalParam(searchParams, "entity_type");
  if (entityType) {
    if (isEntityType(entityType)) {
      filters.entityType = entityType;
    } else {
      errors.push(`entity_type must be one of: ${entityTypes.join(", ")}.`);
    }
  }

  const predicate = optionalParam(searchParams, "predicate");
  if (predicate) {
    if (isRelationPredicate(predicate)) {
      filters.predicate = predicate;
    } else {
      errors.push(`predicate must be one of: ${relationPredicates.join(", ")}.`);
    }
  }

  const connectionClass = optionalParam(searchParams, "connection_class");
  if (connectionClass) {
    if (isConnectionClass(connectionClass)) {
      filters.connectionClass = connectionClass;
    } else {
      errors.push(`connection_class must be one of: ${connectionClasses.join(", ")}.`);
    }
  }

  assignOptionalString(filters, "topic", optionalParam(searchParams, "topic"));
  assignOptionalString(filters, "person", optionalParam(searchParams, "person"));
  assignOptionalString(
    filters,
    "organization",
    optionalParam(searchParams, "organization") ?? optionalParam(searchParams, "organisation"),
  );

  const dateFrom = optionalParam(searchParams, "date_from");
  if (dateFrom) {
    if (isIsoDate(dateFrom)) {
      filters.dateFrom = dateFrom;
    } else {
      errors.push("date_from must use YYYY-MM-DD format.");
    }
  }

  const dateTo = optionalParam(searchParams, "date_to");
  if (dateTo) {
    if (isIsoDate(dateTo)) {
      filters.dateTo = dateTo;
    } else {
      errors.push("date_to must use YYYY-MM-DD format.");
    }
  }

  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    errors.push("date_from must be before or equal to date_to.");
  }

  const includeHistorical = optionalParam(searchParams, "include_historical");
  if (includeHistorical) {
    const parsed = parseBoolean(includeHistorical);
    if (parsed === undefined) {
      errors.push("include_historical must be true or false.");
    } else {
      filters.includeHistorical = parsed;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: filters };
}

export function getPublicGraphHandlerResult(
  requestUrl: string,
  api: PublicApiReader,
): PublicGraphHandlerResult {
  const url = new URL(requestUrl);
  const filters = parsePublicGraphFilters(url.searchParams);

  if (!filters.ok) {
    return {
      status: 400,
      body: {
        error: "Invalid public graph filters.",
        details: filters.errors,
      },
    };
  }

  return {
    status: 200,
    body: api.getPublicGraph(filters.value),
  };
}

export function getPublicEntityHandlerResult(
  entityId: string,
  api: PublicApiReader,
): PublicEntityHandlerResult {
  const entity = api.getPublicEntityDetail(entityId);

  if (!entity) {
    return {
      status: 404,
      body: { error: "Public entity not found." },
    };
  }

  return { status: 200, body: entity };
}

export function getPublicClaimHandlerResult(
  claimId: string,
  api: PublicApiReader,
): PublicClaimHandlerResult {
  const claim = api.getPublicClaimDetail(claimId);

  if (!claim) {
    return {
      status: 404,
      body: { error: "Public claim not found." },
    };
  }

  return { status: 200, body: claim };
}

function optionalParam(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key)?.trim();
  return value ? value : undefined;
}

function assignOptionalString<K extends "topic" | "person" | "organization">(
  filters: PublicGraphFilters,
  key: K,
  value: string | undefined,
): void {
  if (value) {
    filters[key] = value;
  }
}

function parseBoolean(value: string): boolean | undefined {
  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  return undefined;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

export type { ConnectionClass, EntityType, RelationPredicate };
