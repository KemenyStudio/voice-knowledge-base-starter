#!/usr/bin/env node
/**
 * One-off import of the old chat history from Azure Cosmos DB into Supabase
 * (`chat_messages` and `answer_ratings`).
 *
 *   node --env-file=.env.local scripts/migrate-cosmos-to-supabase.mjs <defaultChatbotId> [--dry-run]
 *
 * Old messages have no assistant attached (or, for a short period, a chatbotId);
 * those without one are assigned to <defaultChatbotId> (pass the assistant that should own them).
 * Messages of users that no longer exist, or of chatbots that no longer exist,
 * are skipped and counted. Re-running is safe (existing ids are ignored).
 *
 * Needs COSMOSDB_CONNECTION_STRING, COSMOSDB_DATABASE_NAME, NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY. `@azure/cosmos` is a devDependency used only here;
 * remove it once the import is done.
 */
import { CosmosClient } from "@azure/cosmos"
import { createClient } from "@supabase/supabase-js"

const [defaultChatbotId, ...flags] = process.argv.slice(2)
const dryRun = flags.includes("--dry-run")

if (!defaultChatbotId) {
  console.error("Usage: migrate-cosmos-to-supabase.mjs <defaultChatbotId> [--dry-run]")
  process.exit(1)
}
for (const name of [
  "COSMOSDB_CONNECTION_STRING",
  "COSMOSDB_DATABASE_NAME",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
]) {
  if (!process.env[name]) {
    console.error(`Missing ${name}`)
    process.exit(1)
  }
}

const cosmos = new CosmosClient(process.env.COSMOSDB_CONNECTION_STRING).database(
  process.env.COSMOSDB_DATABASE_NAME
)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

async function fetchAll(table, columns, key = "id") {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order(key).range(from, from + 999)
    if (error) throw error
    rows.push(...data)
    if (data.length < 1000) return rows
  }
}

const users = new Set((await fetchAll("profiles", "id")).map((r) => r.id))
const chatbots = new Set((await fetchAll("chatbots", "id")).map((r) => r.id))
if (!chatbots.has(defaultChatbotId)) {
  console.error(`Chatbot ${defaultChatbotId} does not exist`)
  process.exit(1)
}
console.log(`Supabase: ${users.size} users, ${chatbots.size} chatbots${dryRun ? "  (dry run)" : ""}`)

async function insertBatches(table, rows, conflict) {
  let inserted = 0
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500)
    if (dryRun) {
      inserted += batch.length
      continue
    }
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: conflict, ignoreDuplicates: true })
    if (error) throw new Error(`${table}: ${error.message}`)
    inserted += batch.length
  }
  return inserted
}

// --- messages ---------------------------------------------------------------
const containerId = process.env.COSMOSDB_CONTAINER_NAME || "aisearch"
const { resources: docs } = await cosmos
  .container(containerId)
  .items.query("SELECT * FROM c")
  .fetchAll()
console.log(`Cosmos "${containerId}": ${docs.length} documents`)

const skipped = { user: 0, chatbot: 0, invalid: 0 }
const messages = []
const messageIds = new Set()
for (const doc of docs) {
  if (!doc.id || !doc.user || !doc.session || !doc.message || !["user", "assistant"].includes(doc.role)) {
    skipped.invalid += 1
    continue
  }
  if (!users.has(doc.user)) {
    skipped.user += 1
    continue
  }
  const chatbotId = doc.chatbotId || defaultChatbotId
  if (!chatbots.has(chatbotId)) {
    skipped.chatbot += 1
    continue
  }
  messageIds.add(doc.id)
  messages.push({
    id: String(doc.id),
    user_id: doc.user,
    chatbot_id: chatbotId,
    session_id: String(doc.session),
    role: doc.role,
    content: doc.message,
    title: doc.title && doc.title !== "New Conversation" ? doc.title : null,
    citations: Array.isArray(doc.citations) ? doc.citations : [],
    created_at: doc.createdAt
      ? new Date(doc.createdAt).toISOString()
      : new Date((doc._ts ?? 0) * 1000).toISOString(),
  })
}
console.log(`Messages to import: ${messages.length}  skipped:`, skipped)
console.log(`Imported messages: ${await insertBatches("chat_messages", messages, "id")}`)

// --- ratings ----------------------------------------------------------------
const { resources: logs } = await cosmos
  .container("interaction_logs")
  .items.query("SELECT * FROM c")
  .fetchAll()
const ratings = []
for (const log of logs) {
  if (!messageIds.has(log.id) || !users.has(log.user) || ![1, -1].includes(log.rating)) continue
  ratings.push({
    message_id: log.id,
    user_id: log.user,
    rating: log.rating,
    comment: log.comment || null,
    created_at: log.createdAt
      ? new Date(log.createdAt).toISOString()
      : new Date((log._ts ?? 0) * 1000).toISOString(),
  })
}
console.log(`Ratings: ${logs.length} in Cosmos, ${ratings.length} importable`)
console.log(`Imported ratings: ${await insertBatches("answer_ratings", ratings, "message_id,user_id")}`)
