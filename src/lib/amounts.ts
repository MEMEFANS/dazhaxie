import { formatUnits } from "viem";

// Display strings never round-trip through JavaScript floating-point numbers.
export function formatAssetAmount(amount: bigint, decimals: number, places = 4): string {
  const [integer, fraction = ""] = formatUnits(amount, decimals).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const truncated = fraction.slice(0, places).replace(/0+$/, "");
  return truncated ? `${grouped}.${truncated}` : grouped;
}
