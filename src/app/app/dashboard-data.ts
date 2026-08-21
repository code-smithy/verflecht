import type { UserRole } from "@/domain/ontology";

type CountResult = {
  count: number | null;
  error: { message: string } | null;
};

type SelectResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

type CountQuery = PromiseLike<CountResult> & {
  in(column: string, values: readonly string[]): CountQuery;
};

type SelectQuery<T> = PromiseLike<SelectResult<T>> & {
  in(column: string, values: readonly string[]): SelectQuery<T>;
};

type DashboardTableQuery = {
  select<T = Record<string, unknown>>(
    columns: string,
    options?: { count?: "exact"; head?: boolean },
  ): CountQuery & SelectQuery<T>;
};

export type DashboardSupabaseClient = {
  from(table: string): DashboardTableQuery;
};

type SupabaseLikeClient = {
  from(table: string): unknown;
};

export type DashboardMetric = {
  label: string;
  value: string;
  note: string;
};

export type DashboardSnapshot = {
  metrics: DashboardMetric[];
  reviewWorkload: {
    openQueueItems: number;
    assignedQueueItems: number;
    unqueuedCandidates: number;
    totalActiveItems: number;
  };
  ingestionWork: {
    retryableFailures: number;
    dueRetryableFailures: number;
    exhaustedFailures: number;
    runningJobs: number;
  };
  role: UserRole;
  loadedAt: string;
};

type ReviewQueueRow = {
  id: string;
  claim_id: string;
  status: string;
  assigned_to: string | null;
};

type ClaimStatusRow = {
  id: string;
  verification_status: string;
};

type IngestionJobStatusRow = {
  id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  scheduled_at: string;
  error_message: string | null;
};

const reviewCandidateStatuses = ["DETECTED", "PENDING_REVIEW", "DISPUTED"];
const activeQueueStatuses = ["OPEN", "ASSIGNED"];

export function createDashboardSupabaseClient(
  supabase: SupabaseLikeClient,
): DashboardSupabaseClient {
  return {
    from(table: string) {
      return supabase.from(table) as DashboardTableQuery;
    },
  };
}

export async function loadDashboardSnapshot(
  supabase: DashboardSupabaseClient,
  role: UserRole,
  now = new Date(),
): Promise<DashboardSnapshot> {
  const [
    sourceCount,
    documentCount,
    pendingClaimCount,
    publicClaimCount,
    reviewQueueRows,
    candidateClaimRows,
    ingestionJobRows,
  ] = await Promise.all([
    countTableRows(supabase, "sources"),
    countTableRows(supabase, "documents"),
    countTableRows(supabase, "claims", (query) =>
      query.in("verification_status", reviewCandidateStatuses),
    ),
    countTableRows(supabase, "claims", (query) => query.in("verification_status", ["VERIFIED"])),
    selectTableRows<ReviewQueueRow>(
      supabase,
      "review_queue",
      "id,claim_id,status,assigned_to",
      (query) => query.in("status", activeQueueStatuses),
    ),
    selectTableRows<ClaimStatusRow>(supabase, "claims", "id,verification_status", (query) =>
      query.in("verification_status", reviewCandidateStatuses),
    ),
    selectTableRows<IngestionJobStatusRow>(
      supabase,
      "ingestion_jobs",
      "id,status,attempts,max_attempts,scheduled_at,error_message",
    ),
  ]);

  const queuedClaimIds = new Set(reviewQueueRows.map((row) => row.claim_id));
  const openQueueItems = reviewQueueRows.filter((row) => row.status === "OPEN").length;
  const assignedQueueItems = reviewQueueRows.filter((row) => row.status === "ASSIGNED").length;
  const unqueuedCandidates = candidateClaimRows.filter(
    (claim) => !queuedClaimIds.has(claim.id),
  ).length;
  const retryableFailures = ingestionJobRows.filter(isRetryableFailure).length;
  const dueRetryableFailures = ingestionJobRows.filter(
    (job) => isRetryableFailure(job) && Date.parse(job.scheduled_at) <= now.getTime(),
  ).length;
  const exhaustedFailures = ingestionJobRows.filter(
    (job) => job.status === "FAILED" && job.attempts >= job.max_attempts,
  ).length;
  const runningJobs = ingestionJobRows.filter((job) => job.status === "RUNNING").length;

  return {
    metrics: [
      {
        label: "Sources",
        value: formatCount(sourceCount),
        note: "Configured registries and feeds",
      },
      {
        label: "Documents",
        value: formatCount(documentCount),
        note: "Fetched or imported records",
      },
      {
        label: "Pending Claims",
        value: formatCount(pendingClaimCount),
        note: "Candidates awaiting reviewer action",
      },
      {
        label: "Public Claims",
        value: formatCount(publicClaimCount),
        note: "Verified and source-backed",
      },
      {
        label: "Review Workload",
        value: formatCount(openQueueItems + assignedQueueItems + unqueuedCandidates),
        note: "Active queue plus unqueued candidates",
      },
      {
        label: "Retryable Jobs",
        value: formatCount(retryableFailures),
        note: "Failed ingestion work scheduled again",
      },
    ],
    reviewWorkload: {
      openQueueItems,
      assignedQueueItems,
      unqueuedCandidates,
      totalActiveItems: openQueueItems + assignedQueueItems + unqueuedCandidates,
    },
    ingestionWork: {
      retryableFailures,
      dueRetryableFailures,
      exhaustedFailures,
      runningJobs,
    },
    role,
    loadedAt: now.toISOString(),
  };
}

async function countTableRows(
  supabase: DashboardSupabaseClient,
  table: string,
  filter?: (query: CountQuery) => CountQuery,
): Promise<number> {
  const baseQuery = supabase.from(table).select("*", { count: "exact", head: true });
  const { count, error } = await (filter ? filter(baseQuery) : baseQuery);

  if (error) {
    throw new Error(`Failed to count ${table}: ${error.message}`);
  }

  return count ?? 0;
}

async function selectTableRows<T>(
  supabase: DashboardSupabaseClient,
  table: string,
  columns: string,
  filter?: (query: SelectQuery<T>) => SelectQuery<T>,
): Promise<T[]> {
  const baseQuery = supabase.from(table).select<T>(columns);
  const { data, error } = await (filter ? filter(baseQuery) : baseQuery);

  if (error) {
    throw new Error(`Failed to load ${table}: ${error.message}`);
  }

  return data ?? [];
}

function isRetryableFailure(job: IngestionJobStatusRow): boolean {
  return (
    job.status === "PENDING" &&
    typeof job.error_message === "string" &&
    job.error_message.trim().length > 0 &&
    job.attempts < job.max_attempts
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
