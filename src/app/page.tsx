import { PublicGraphService, type PublicGraphProjection } from "@/domain/public-graph";
import { loadPublicResearchRepository } from "@/server/supabase-public-repository";

import { PublicResearchUi } from "./public-research-ui";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { graph, unavailableReason } = await loadPublicGraph();

  return <PublicResearchUi graph={graph} unavailableReason={unavailableReason} />;
}

async function loadPublicGraph(): Promise<{
  graph: PublicGraphProjection;
  unavailableReason?: string;
}> {
  try {
    const repository = await loadPublicResearchRepository();

    return {
      graph: new PublicGraphService(repository).getPublicGraph({ includeHistorical: true }),
    };
  } catch (error) {
    return {
      graph: { nodes: [], edges: [] },
      unavailableReason:
        error instanceof Error ? error.message : "Public graph data could not be loaded.",
    };
  }
}
