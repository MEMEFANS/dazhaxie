import { connection } from "next/server";
import SeedLiquidityPage from "@/components/dapp/token/seed-liquidity-page";

export const dynamic = "force-dynamic";

export default async function Page() {
  await connection();
  return <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10"><SeedLiquidityPage /></main>;
}
