import { PublicGraphService } from "@/domain/public-graph";
import { getPublicEntityHandlerResult } from "@/server/public-api";
import { loadPublicResearchRepository } from "@/server/supabase-public-repository";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const repository = await loadPublicResearchRepository();
    const result = getPublicEntityHandlerResult(id, new PublicGraphService(repository));

    return Response.json(result.body, { status: result.status });
  } catch (error) {
    return Response.json(
      {
        error: "Public entity API is unavailable.",
        details: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 503 },
    );
  }
}
