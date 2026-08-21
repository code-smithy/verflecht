import { describe, expect, it } from "vitest";

import { loadDashboardSnapshot, type DashboardSupabaseClient } from "./dashboard-data";

type Row = Record<string, unknown>;
type QueryError = { message: string; code?: string };

class Query {
  private readonly filters: Array<(row: Row) => boolean> = [];

  constructor(
    private readonly rows: Row[],
    private readonly options?: { count?: "exact"; head?: boolean },
    private readonly error?: QueryError,
  ) {}

  in(column: string, values: readonly string[]): Query {
    this.filters.push((row) => values.includes(String(row[column])));
    return this;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    if (this.error) {
      const value = this.options?.head
        ? { count: null, error: this.error }
        : { data: null, error: this.error };

      return Promise.resolve(value).then(onfulfilled, onrejected);
    }

    const filteredRows = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    const value = this.options?.head
      ? { count: filteredRows.length, error: null }
      : { data: filteredRows, error: null };

    return Promise.resolve(value).then(onfulfilled, onrejected);
  }
}

function mockSupabase(
  tables: Record<string, Row[]>,
  tableErrors: Record<string, QueryError> = {},
): DashboardSupabaseClient {
  return {
    from(table: string) {
      return {
        select(_columns: string, options?: { count?: "exact"; head?: boolean }) {
          return new Query(tables[table] ?? [], options, tableErrors[table]) as never;
        },
      };
    },
  };
}

describe("dashboard data", () => {
  it("loads counts, review workload, and retryable ingestion work from Supabase tables", async () => {
    const snapshot = await loadDashboardSnapshot(
      mockSupabase({
        sources: [{ id: "source-1" }, { id: "source-2" }],
        documents: [{ id: "document-1" }],
        claims: [
          { id: "claim-1", verification_status: "PENDING_REVIEW" },
          { id: "claim-2", verification_status: "DISPUTED" },
          { id: "claim-3", verification_status: "VERIFIED" },
        ],
        review_queue: [{ id: "queue-1", claim_id: "claim-1", status: "OPEN", assigned_to: null }],
        ingestion_jobs: [
          {
            id: "job-1",
            status: "PENDING",
            attempts: 1,
            max_attempts: 3,
            scheduled_at: "2026-08-18T10:00:00.000Z",
            error_message: "network unavailable",
          },
          {
            id: "job-2",
            status: "FAILED",
            attempts: 3,
            max_attempts: 3,
            scheduled_at: "2026-08-18T09:00:00.000Z",
            error_message: "network unavailable",
          },
          {
            id: "job-3",
            status: "RUNNING",
            attempts: 1,
            max_attempts: 3,
            scheduled_at: "2026-08-18T09:00:00.000Z",
            error_message: null,
          },
        ],
      }),
      "ADMIN",
      new Date("2026-08-18T10:02:00.000Z"),
    );

    expect(snapshot.metrics.map((metric) => [metric.label, metric.value])).toEqual([
      ["Sources", "2"],
      ["Documents", "1"],
      ["Pending Claims", "2"],
      ["Public Claims", "1"],
      ["Review Workload", "2"],
      ["Retryable Jobs", "1"],
    ]);
    expect(snapshot.reviewWorkload).toEqual({
      openQueueItems: 1,
      assignedQueueItems: 0,
      unqueuedCandidates: 1,
      totalActiveItems: 2,
    });
    expect(snapshot.ingestionWork).toEqual({
      retryableFailures: 1,
      dueRetryableFailures: 1,
      exhaustedFailures: 1,
      runningJobs: 1,
    });
  });

  it("keeps dashboard counts available when the optional ingestion jobs table is not deployed", async () => {
    const snapshot = await loadDashboardSnapshot(
      mockSupabase(
        {
          sources: [{ id: "source-1" }],
          documents: [],
          claims: [],
          review_queue: [],
        },
        {
          ingestion_jobs: {
            code: "PGRST205",
            message: "Could not find the table 'public.ingestion_jobs' in the schema cache",
          },
        },
      ),
      "ADMIN",
      new Date("2026-08-18T10:02:00.000Z"),
    );

    expect(snapshot.metrics.map((metric) => [metric.label, metric.value])).toEqual([
      ["Sources", "1"],
      ["Documents", "0"],
      ["Pending Claims", "0"],
      ["Public Claims", "0"],
      ["Review Workload", "0"],
      ["Retryable Jobs", "0"],
    ]);
    expect(snapshot.ingestionWork).toEqual({
      retryableFailures: 0,
      dueRetryableFailures: 0,
      exhaustedFailures: 0,
      runningJobs: 0,
    });
  });
});
