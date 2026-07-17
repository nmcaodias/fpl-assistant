import { getPlayerHistories, MAX_HISTORY_IDS } from "@/lib/fpl-server";

/**
 * Recent per-match history for a batch of players: /api/fpl/players?ids=1,2,3
 *
 * Each id costs one upstream request (the FPL API has no batch endpoint), so
 * the batch is capped — callers scope this to a squad or a candidate shortlist
 * rather than the whole market.
 */
export async function GET(request: Request) {
  const param = new URL(request.url).searchParams.get("ids");
  if (!param) {
    return Response.json({ error: "Missing ids parameter." }, { status: 400 });
  }

  const raw = param.split(",").filter((s) => s.trim() !== "");
  const ids = raw.map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0 || ids.length !== raw.length) {
    return Response.json({ error: "ids must be a comma-separated list of player IDs." }, { status: 400 });
  }
  if (new Set(ids).size > MAX_HISTORY_IDS) {
    return Response.json(
      { error: `Too many ids — ${MAX_HISTORY_IDS} at most.` },
      { status: 400 },
    );
  }

  try {
    const data = await getPlayerHistories(ids);
    return Response.json(data, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" },
    });
  } catch {
    return Response.json(
      { error: "Could not reach the FPL API. Try again in a minute." },
      { status: 502 },
    );
  }
}
