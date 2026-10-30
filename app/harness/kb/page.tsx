import { notFound } from "next/navigation"

import { HarnessKnowledge } from "@/components/harness/HarnessKnowledge"

export const dynamic = "force-dynamic"

/** Local-only page. Production stays on 404 unless the fixture flag is set. */
export default function HarnessKnowledgePage() {
  if (process.env.COMPUTER_USE_FIXTURE !== "1") notFound()
  return <HarnessKnowledge />
}
