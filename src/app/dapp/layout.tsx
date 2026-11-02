import { DAppShell } from "@/components/dapp/shell";

export default function DAppLayout({ children }: { children: React.ReactNode }) {
  return <DAppShell>{children}</DAppShell>;
}
