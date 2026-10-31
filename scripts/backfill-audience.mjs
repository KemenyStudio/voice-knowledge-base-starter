#!/usr/bin/env node
/**
 * Fills the audience (entity types a document applies to) of an assistant from
 * the tags its documents already have, and writes it to the search index.
 *
 *   node --env-file=.env scripts/backfill-audience.mjs <chatbotId> [--dry-run]
 *
 * Safe by design:
 *  - only documents still "unclassified" are touched;
 *  - a document is classified only when EVERY one of its target tags maps to
 *    an entity type of the assistant (otherwise it is left for review, since
 *    narrowing it could hide it from someone it applies to);
 *  - it never turns the assistant's audience_filter on.
 *
 * Needs OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"

import { audienceAttributes, normalizeAliases, tagsToAudience } from "../lib/audience.ts"

const [chatbotId, ...flags] = process.argv.slice(2)
const dryRun = flags.includes("--dry-run")
if (!chatbotId) {
  console.error("Usage: backfill-audience.mjs <chatbotId> [--dry-run]")
  process.exit(1)
}

const openai = new OpenAI()
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)
const clip = (v) => (v.length > 512 ? v.slice(0, 512) : v)

const { data: chatbot, error: chatbotError } = await supabase
  .from("chatbots")
  .select("id, audience_options, audience_filter, audience_aliases")
  .eq("id", chatbotId)
  .single()
if (chatbotError) throw chatbotError
const options = chatbot.audience_options ?? []
const aliases = normalizeAliases(chatbot.audience_aliases)
if (options.length === 0) {
  console.error("This assistant has no audience_options configured.")
  process.exit(1)
}

const { data: files, error } = await supabase
  .from("files")
  .select("*")
  .eq("chatbot_id", chatbotId)
if (error) throw error

let classified = 0
let left = 0
let failed = 0
for (const file of files) {
  if (file.audience_status !== "unclassified") continue
  const audience = tagsToAudience(file.metadata?.target_tag ?? [], options, aliases)
  if (!audience || audience.length === 0) {
    left += 1
    continue
  }
  console.log(`${dryRun ? "[dry-run] " : ""}${file.file_name} -> ${audience.join(", ")}`)
  if (dryRun) {
    classified += 1
    continue
  }
  try {
    const meta = file.metadata ?? {}
    const attributes = {
      file_row_id: file.id,
      chatbot_id: file.chatbot_id,
      file_name: clip(file.file_name),
      ...(meta.type_tag ? { type_tag: clip(meta.type_tag) } : {}),
      ...(meta.target_tag?.length ? { target_tag: clip(meta.target_tag.join(", ")) } : {}),
      ...(meta.entity_tag?.length ? { entity_tag: clip(meta.entity_tag.join(", ")) } : {}),
      ...audienceAttributes(options, audience),
    }
    if (file.openai_file_id && file.vector_store_id) {
      await openai.vectorStores.files.update(file.openai_file_id, {
        vector_store_id: file.vector_store_id,
        attributes,
      })
    }
    const { error: updateError } = await supabase
      .from("files")
      .update({ audience, audience_suggested: [], audience_status: "confirmed" })
      .eq("id", file.id)
    if (updateError) throw updateError
    classified += 1
  } catch (err) {
    failed += 1
    console.error(`failed: ${file.file_name}`, err?.message ?? err)
  }
}

console.log(
  `\n${dryRun ? "Would classify" : "Classified"} ${classified}; left for review ${left}; failed ${failed}. ` +
    `audience_filter stays ${chatbot.audience_filter ? "ON" : "OFF"}.`
)
