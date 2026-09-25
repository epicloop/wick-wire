import { NextResponse } from "next/server";
import { worker } from "@/lib/live";

export const dynamic = "force-dynamic";

// Scanner track record from our own server (paper trades, RESPECT checks, signals).
export async function GET() {
  const t = await worker<unknown>("/track");
  return t ? NextResponse.json(t) : NextResponse.json({ error: "scanner offline" }, { status: 503 });
}
