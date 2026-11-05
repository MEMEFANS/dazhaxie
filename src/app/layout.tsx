import type { Metadata } from "next";
import { StoreProvider } from "@/lib/store";
import { RouteShell } from "@/components/dapp/route-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "蟹比特 XIE BIT · CaBi 生态与蟹礼",
  description:
    "了解蟹比特 CaBi 生态份额、代币配额、实物蟹礼兑换与社群动态。查看项目规则与开放进度。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <StoreProvider><RouteShell>{children}</RouteShell></StoreProvider>
      </body>
    </html>
  );
}
