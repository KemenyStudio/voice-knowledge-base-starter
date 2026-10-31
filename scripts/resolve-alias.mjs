// Lets `node scripts/test-voice.mjs` import @/ the same way Next does.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))

export function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@/")) return nextResolve(specifier, context)
  const rel = specifier.slice(2)
  const withExt = rel.endsWith(".ts") || rel.endsWith(".tsx") ? rel : `${rel}.ts`
  const file = join(root, withExt)
  if (!existsSync(file)) return nextResolve(specifier, context)
  return { url: pathToFileURL(file).href, shortCircuit: true }
}
