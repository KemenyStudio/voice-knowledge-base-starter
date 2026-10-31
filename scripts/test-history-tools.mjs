// Titles, auth copy and conversation export.
//   node scripts/test-history-tools.mjs
import assert from "node:assert/strict"

import { authErrorMessage } from "../lib/auth/messages.ts"
import {
  cleanSessionTitle,
  sessionHeading,
  titleFrom,
} from "../lib/chat/session-title.ts"
import {
  EXPORT_DISCLAIMER,
  transcriptToMarkdown,
} from "../lib/chat/references.ts"

assert.equal(titleFrom(""), "Conversación")
assert.equal(titleFrom("  hola   mundo "), "hola mundo")
assert.equal(titleFrom("a".repeat(80)).endsWith("..."), true)
assert.equal(titleFrom("a".repeat(80)).length, 60)

assert.equal(sessionHeading("New Conversation", "¿Qué es el CAT?"), "¿Qué es el CAT?")
assert.equal(sessionHeading("Conversación", ""), "Conversación")
assert.equal(sessionHeading("  Capital mínimo  ", "otra cosa"), "Capital mínimo")

assert.equal(cleanSessionTitle("  hola\nadios  "), "hola adios")
assert.equal(cleanSessionTitle("   "), null)
assert.equal(cleanSessionTitle("x".repeat(121)), null)
assert.equal(cleanSessionTitle("ok"), "ok")

assert.equal(
  authErrorMessage("Invalid login credentials", "fallback"),
  "Correo o contraseña incorrectos."
)
assert.equal(
  authErrorMessage("Email not confirmed", "fallback"),
  "Confirma tu correo antes de entrar."
)
assert.equal(authErrorMessage("Algo raro del servidor", "fallback"), "fallback")
assert.equal(authErrorMessage("La sesión caducó", "fallback"), "La sesión caducó")

const markdown = transcriptToMarkdown("Capital", [
  { role: "user", content: "¿Cuál es el capital mínimo?" },
  {
    role: "assistant",
    content:
      "El mínimo es X [1].\n\nReferencias:\n[1] Ley de Instituciones de Crédito, (páginas 5-12)",
    citations: [{ number: 1, title: "Ley de Instituciones de Crédito" }],
  },
])
assert.match(markdown, /# Capital/)
assert.match(markdown, /## ¿Cuál es el capital mínimo\?/)
assert.match(markdown, /1\. Ley de Instituciones de Crédito \(páginas 5–12\)/)
assert.match(markdown, new RegExp(EXPORT_DISCLAIMER.replace(/[.]/g, "\\.")))

console.log("history tools: ok")
