"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import type { SupportOrder } from "@/lib/support";
import { LoadingBlock, PageStack, SectionHead } from "@/components/dapp/ui";
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
    <SectionHead eyebrow="CUSTOMER CARE" title={afterSales ? "售后服务" : "客服与售后"} desc="物流查询、收货信息修改、商品问题，都可以在这里提交。客服回复和处理进度在下方查看。" />
    <TicketForm initialCategory={afterSales ? "售后服务" : "认购问题"} order={order} onSubmitted={() => setFilter("all")} />
    <TicketList filter={filter} onFilterChange={setFilter} />
  </PageStack>;
}
