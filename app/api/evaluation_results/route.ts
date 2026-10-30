import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

import { errorResponse } from "@/lib/http"
import { requireUser } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest) {
  try {
    await requireUser()

    const EVAL_RESULTS_DIR = path.join(
      process.cwd(),
      "public",
      "evaluation_results"
    )

    if (!fs.existsSync(EVAL_RESULTS_DIR)) {
      return NextResponse.json([], { status: 200 })
    }

    const directories = fs
      .readdirSync(EVAL_RESULTS_DIR, { withFileTypes: true })
      .filter(
        (dirent) =>
          dirent.isDirectory() && dirent.name.startsWith("evaluation_results_")
      )
      .map((dirent) => path.join(EVAL_RESULTS_DIR, dirent.name))

    if (!directories.length) {
      return NextResponse.json([], { status: 200 })
    }

    const resultFiles: string[] = []
    directories.forEach((directory) => {
      const jsonPath = path.join(directory, "evaluation_results.json")
      if (fs.existsSync(jsonPath)) {
        resultFiles.push(path.relative(EVAL_RESULTS_DIR, jsonPath))
      }
    })

    return NextResponse.json(resultFiles, { status: 200 })
  } catch (error) {
    return errorResponse(error, "GET /api/evaluation_results")
  }
}
