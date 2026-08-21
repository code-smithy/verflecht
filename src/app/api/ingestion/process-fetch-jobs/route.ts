import { getUserAppRole, isInternalAppRole } from "@/app/auth-roles";
import { processDueFetchJobs } from "@/server/ingestion-processor";
import {
  createAnonSupabaseClient,
  createServiceRoleSupabaseClient,
} from "@/server/supabase-server";

export const dynamic = "force-dynamic";

type ProcessFetchJobsRequest = {
  limit?: unknown;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getAuthorizedUser(request);
    const role = getUserAppRole(user);

    if (!isInternalAppRole(role)) {
      return Response.json({ error: "Internal app role required." }, { status: 403 });
    }

    const body = await readJsonBody(request);
    const limit = parseLimit(body.limit);
    const results = await processDueFetchJobs(createServiceRoleSupabaseClient(), { limit });

    return Response.json({
      processed: results.length,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ingestion processor error.";
    const status = message === "Authentication required." ? 401 : 500;

    return Response.json({ error: message }, { status });
  }
}

async function getAuthorizedUser(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

  if (!token) {
    throw new Error("Authentication required.");
  }

  const { data, error } = await createAnonSupabaseClient().auth.getUser(token);

  if (error || !data.user) {
    throw new Error("Authentication required.");
  }

  return data.user;
}

async function readJsonBody(request: Request): Promise<ProcessFetchJobsRequest> {
  try {
    const body = (await request.json()) as ProcessFetchJobsRequest;
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

function parseLimit(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, 10)
    : 1;
}
