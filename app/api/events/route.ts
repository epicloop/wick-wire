import { NextResponse } from "next/server";
import { worker } from "@/lib/live";

export const dynamic = "force-dynamic";

// Shared event feed written by the scanner (news, on-chain, signal changes, paper trades).
export async function GET(req: Request) {
  const since = Number(new URL(req.url).searchParams.get("since") ?? 0) || 0;
  const e = await worker<unknown>(`/events${since ? `?since=${since}` : ""}`);
  return e ? NextResponse.json(e) : NextResponse.json({ error: "scanner offline" }, { status: 503 });
}
