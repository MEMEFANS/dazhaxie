import { connection } from "next/server";
import TokenPageClient from "@/components/dapp/token/token-page-client";

export const dynamic = "force-dynamic";

/**
 * This page depends entirely on wallet state and live claim-pool data.
 * Keep it out of the Cache Components static shell so a deployed client
 * cannot briefly resume an older token/claim UI during navigation.
 */
export default async function TokenPage() {
  await connection();
  return <TokenPageClient />;
}
