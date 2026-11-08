"use client";

import { useState } from "react";
import { Headphones } from "lucide-react";
import { useStore } from "@/lib/store";
import type { SupportOrder } from "@/lib/support";
import { LoadingBlock, PageStack, PageHeader } from "@/components/dapp/ui";
import { TicketForm } from "./ticket-form";
import { TicketList } from "./ticket-list";
import type { FilterKey } from "./category-picker";

export default function SupportPageClient({ afterSales, order }: { afterSales: boolean; order?: SupportOrder }) {
  const { state, hydrated } = useStore();
  if (!hydrated) return <LoadingBlock />;
  return <SupportContent key={[state.address.toLowerCase(), state.chainId, afterSales, order?.type, order?.id].join(":")} afterSales={afterSales} order={order} />;
}

function SupportContent({ afterSales, order }: { afterSales: boolean; order?: SupportOrder }) {
  const [filter, setFilter] = useState<FilterKey>("all");
  return <PageStack>
    <PageHeader eyebrow="HERE TO HELP" icon={Headphones} title={afterSales ? "售后服务" : "客服与售后"} desc="物流、收货、商品问题，随时在这里联系我们。" />
    <div className="grid items-start gap-4 sm:gap-6 lg:grid-cols-[1.1fr_1fr]">
      <TicketForm initialCategory={afterSales ? "售后服务" : "认购问题"} order={order} onSubmitted={() => setFilter("all")} />
      <TicketList filter={filter} onFilterChange={setFilter} />
    </div>
  </PageStack>;
}
