import SupportPageClient from "@/components/dapp/support/support-page-client";
import type { SupportOrder } from "@/lib/support";

export default async function SupportPage({ searchParams }: PageProps<"/dapp/support">) {
  const query = await searchParams;
  const order: SupportOrder | undefined = (query.type === "subscribe" || query.type === "exchange") && typeof query.order === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(query.order)
    ? { type: query.type, id: query.order } : undefined;
  return <SupportPageClient afterSales={query.category === "after-sales" || Boolean(order)} order={order} />;
}
