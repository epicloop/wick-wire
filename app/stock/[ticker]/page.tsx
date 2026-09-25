import { notFound } from "next/navigation";
import Detail from "@/components/Detail";
import { STOCKS, isTicker } from "@/lib/stocks";

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }) {
  const t = (await params).ticker.toUpperCase();
  return { title: isTicker(t) ? `${t} · Wick Wire` : "Wick Wire", description: isTicker(t) ? `Why ${STOCKS[t].token} moved while Wall Street was closed.` : undefined };
}

export default async function StockPage({ params }: { params: Promise<{ ticker: string }> }) {
  const t = (await params).ticker.toUpperCase();
  if (!isTicker(t)) notFound();
  return <Detail ticker={t} />;
}
