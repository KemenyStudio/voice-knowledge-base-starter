// End-to-end smoke test of the upload flow against a running app and the real
// Supabase / OpenAI projects. Everything it creates is deleted at the end.
//
//   node --env-file=.env scripts/e2e-upload-smoke.mjs [baseUrl]
//
// Covers: signed upload of a file larger than the serverless body limit,
// indexing, authorization (outsider is rejected), path tampering, duplicate
// registration, signed download and deletion.
import { createClient } from "@supabase/supabase-js"
import OpenAI from "openai"

const base = process.argv[2] || "http://localhost:3100"
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "knowledge"
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const openai = new OpenAI()
const ref = new URL(url).hostname.split(".")[0]
const run = Date.now()

let passed = 0
let failed = 0
const check = (name, ok, detail = "") => {
  ok ? passed++ : failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`)
}

async function makeUser(label) {
  const email = `e2e-${label}-${run}@example.com`
  const password = `Pw-${run}-${label}!`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw error
  const client = createClient(url, anon, { auth: { persistSession: false } })
  const { data: session, error: signInError } =
    await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  return { id: data.user.id, client, session: session.session }
}

const cookieFor = (session) =>
  `sb-${ref}-auth-token=${encodeURIComponent(JSON.stringify(session))}`

const api = (user, path, init = {}) =>
  fetch(`${base}${path}`, {
    redirect: "manual",
    ...init,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieFor(user.session),
      ...init.headers,
    },
  })

const created = { users: [], teamId: null, chatbotId: null }
let vectorStoreId = null

try {
  const owner = await makeUser("owner")
  const outsider = await makeUser("outsider")
  created.users.push(owner.id, outsider.id)

  const { data: team } = await admin
    .from("teams")
    .insert({ name: `E2E ${run}`, created_by: owner.id })
    .select()
    .single()
  created.teamId = team.id
  await admin
    .from("team_members")
    .insert({ team_id: team.id, user_id: owner.id, role: "admin" })
  const { data: chatbot } = await admin
    .from("chatbots")
    .insert({ team_id: team.id, name: "E2E assistant" })
    .select()
    .single()
  created.chatbotId = chatbot.id

  // --- authorization on the sign step
  const asOutsider = await api(outsider, "/api/upload/sign", {
    method: "POST",
    body: JSON.stringify({ fileName: "a.txt", size: 10, chatbotId: chatbot.id }),
  })
  check("outsider cannot request an upload URL", [403, 404].includes(asOutsider.status), asOutsider.status)

  const anonymous = await fetch(`${base}/api/upload/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: "a.txt", size: 10, chatbotId: chatbot.id }),
  })
  check("anonymous request is rejected", [401, 307, 308].includes(anonymous.status), anonymous.status)

  const badExt = await api(owner, "/api/upload/sign", {
    method: "POST",
    body: JSON.stringify({ fileName: "virus.exe", size: 10, chatbotId: chatbot.id }),
  })
  check("unsupported extension -> 415", badExt.status === 415, badExt.status)

  const tooBig = await api(owner, "/api/upload/sign", {
    method: "POST",
    body: JSON.stringify({ fileName: "big.pdf", size: 5 * 1024 ** 3, chatbotId: chatbot.id }),
  })
  check("oversized file -> 413", tooBig.status === 413, tooBig.status)

  // --- a 6 MB document: larger than the ~4.5 MB serverless body limit
  const words = ["regulación", "capital", "crédito", "riesgo", "liquidez", "reserva"]
  let text = ""
  for (let i = 0; text.length < 6 * 1024 * 1024; i++) {
    text += `${words[i % words.length]} ${i} `
    if (i % 20 === 19) text += "\n"
  }
  text += "\nThe secret codeword for this test is PINEAPPLE-" + run + "\n"
  const bytes = Buffer.from(text)

  const signed = await api(owner, "/api/upload/sign", {
    method: "POST",
    body: JSON.stringify({ fileName: "grande.txt", size: bytes.length, chatbotId: chatbot.id }),
  })
  const target = await signed.json()
  check("owner gets a signed upload target", signed.status === 200 && !!target.token, signed.status)

  const { error: uploadError } = await owner.client.storage
    .from(target.bucket)
    .uploadToSignedUrl(target.path, target.token, bytes, { contentType: "text/plain" })
  check(`${(bytes.length / 1024 / 1024).toFixed(1)} MB goes straight to storage`, !uploadError, uploadError?.message)

  const finalize = (path, name = "grande.txt") =>
    api(owner, "/api/upload", {
      method: "POST",
      body: JSON.stringify({
        fileName: name,
        storagePath: path,
        chatbotId: chatbot.id,
        metadata: { type_tag: "Prueba", target_tag: [], entity_tag: [] },
      }),
    })

  const tampered = await finalize(`${team.id}/00000000-0000-0000-0000-000000000000/x.txt`)
  check("path outside the assistant folder -> 400", tampered.status === 400, tampered.status)

  const done = await finalize(target.path)
  const doneBody = await done.json()
  const file = doneBody.file
  check("finalize records and indexes the file", done.status === 200 && !!file?.id, JSON.stringify(doneBody).slice(0, 200))
  check("file has an OpenAI file id", !!file?.openai_file_id, file?.sync_status)
  check("size stored matches", file?.size_bytes === bytes.length, `${file?.size_bytes} vs ${bytes.length}`)

  const dup = await finalize(target.path)
  check("registering the same upload twice -> 409", dup.status === 409, dup.status)

  const { data: chatbotRow } = await admin.from("chatbots").select("vector_store_id").eq("id", chatbot.id).single()
  vectorStoreId = chatbotRow.vector_store_id
  check("assistant got its own vector store", !!vectorStoreId)

  // --- download
  const dl = await api(owner, `/api/files/${file.id}/download`)
  const loc = dl.headers.get("location")
  check("download redirects to a signed URL", dl.status === 302 && !!loc, dl.status)
  if (loc) {
    const body = await (await fetch(loc)).arrayBuffer()
    check("downloaded bytes match the upload", body.byteLength === bytes.length, body.byteLength)
  }
  const dlOutsider = await api(outsider, `/api/files/${file.id}/download`)
  check("outsider cannot download", [403, 404].includes(dlOutsider.status), dlOutsider.status)

  // --- delete
  const del = await api(owner, `/api/files/${file.id}`, { method: "DELETE" })
  check("owner can delete the file", del.status === 200, del.status)
  const { data: gone } = await admin.storage.from(bucket).list(`${team.id}/${chatbot.id}`)
  check("object removed from storage", (gone ?? []).length === 0, JSON.stringify(gone))
} catch (error) {
  failed++
  console.error("FAIL  unexpected error:", error)
} finally {
  // --- cleanup: leave nothing behind
  try {
    if (created.chatbotId) {
      const { data } = await admin.from("files").select("blob_name").eq("chatbot_id", created.chatbotId)
      const paths = (data ?? []).map((r) => r.blob_name).filter(Boolean)
      if (paths.length) await admin.storage.from(bucket).remove(paths)
      await admin.from("files").delete().eq("chatbot_id", created.chatbotId)
      await admin.from("chatbots").delete().eq("id", created.chatbotId)
    }
    if (created.teamId) {
      await admin.from("team_members").delete().eq("team_id", created.teamId)
      await admin.from("teams").delete().eq("id", created.teamId)
    }
    for (const id of created.users) await admin.auth.admin.deleteUser(id)
    if (vectorStoreId) {
      const remote = await openai.vectorStores.files.list(vectorStoreId).catch(() => null)
      for (const f of remote?.data ?? []) await openai.files.delete(f.id).catch(() => undefined)
      await openai.vectorStores.delete(vectorStoreId).catch(() => undefined)
    }
    console.log("cleanup done")
  } catch (error) {
    console.error("cleanup problem:", error)
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
