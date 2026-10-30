// Lets `node scripts/test-*.mjs` import TypeScript that uses the @/ alias.
import { register } from "node:module"

register("./ts-alias-hook.mjs", import.meta.url)
