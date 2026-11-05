import { connection } from "next/server";
import { AdminRequestError } from "@/lib/server/admin-session";
import { claimProof } from "@/lib/server/claim-proof";
import { currentCommunityWallet } from "@/lib/server/community-auth";

/**
 * 领取证明接口：只返回当前批次中该地址的累计额度与 Merkle proof。
 * 服务端不签发任何授权、不持有私钥；用户拿到 proof 后直接调用领取池合约。
 */
export async function GET() {
  await connection();
  const wallet = await currentCommunityWallet();
  const headers = { "Cache-Control": "no-store" };
  try {
    return Response.json(await claimProof(wallet?.address), { headers });
  } catch (error) {
    if (error instanceof AdminRequestError) {
      return Response.json({ configured: false, claimPool: null, chainId: 0, authenticated: Boolean(wallet), error: error.message, root: null, epoch: 0, amount: "0", chainClaimed: "0", claimable: "0", proof: [], lpReady: false }, { headers });
    }
    throw error;
  }
}
