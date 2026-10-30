// Resolves the @/ alias and loads TypeScript for `node --import ./scripts/register-ts-alias.mjs`.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function withExtension(base) {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const hit = withExtension(path.join(root, specifier.slice(2)))
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true }
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL?.startsWith("file:")
  ) {
    const parent = fileURLToPath(context.parentURL)
    const abs = path.resolve(path.dirname(parent), specifier)
    if (!path.extname(abs) && (abs === root || abs.startsWith(root + path.sep))) {
      const hit = withExtension(abs)
      if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && (url.endsWith(".tsx") || url.endsWith(".ts"))) {
    const source = readFileSync(fileURLToPath(url), "utf8")
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: url,
    })
    return { format: "module", source: outputText, shortCircuit: true }
  }
  return nextLoad(url, context)
}
