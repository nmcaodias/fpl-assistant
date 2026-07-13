import { getBootstrap } from "@/lib/fpl-server";

export async function GET() {
  try {
    const data = await getBootstrap();
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
