import { FplError, getEntry } from "@/lib/fpl-server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const teamId = parseInt(id, 10);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return Response.json({ error: "Invalid team ID." }, { status: 400 });
  }

  try {
    const data = await getEntry(teamId);
    return Response.json(data, {
      headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" },
    });
  } catch (err) {
    if (err instanceof FplError && err.status === 404) {
      return Response.json(
        { error: `No FPL team found with ID ${teamId}.` },
        { status: 404 },
      );
    }
    return Response.json(
      { error: "Could not reach the FPL API. Try again in a minute." },
      { status: 502 },
    );
  }
}
