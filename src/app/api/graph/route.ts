import { PublicGraphService } from "@/domain/public-graph";
import { getPublicGraphHandlerResult } from "@/server/public-api";
import { loadPublicResearchRepository } from "@/server/supabase-public-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const repository = await loadPublicResearchRepository();
    const result = getPublicGraphHandlerResult(request.url, new PublicGraphService(repository));

    return Response.json(result.body, { status: result.status });
  } catch (error) {
    return Response.json(
      {
        error: "Public graph API is unavailable.",
        details: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 503 },
    );
  }
}
