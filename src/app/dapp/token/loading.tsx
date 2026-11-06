import { LoadingBlock } from "@/components/dapp/ui";

// The token page reads wallet and live claim-pool state. A loading boundary
// prevents Next's client router from retaining a prefetched token page shell
// while the current automatic LP view is being streamed.
export default function Loading() {
  return <LoadingBlock />;
}
