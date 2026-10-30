import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { findOption } from "@/lib/audience"
import { uuidSchema, requireChatbotAccess } from "@/lib/auth/access"
import { errorResponse } from "@/lib/http"
import { savePrefs } from "@/lib/preferences"
import { requireUser, type AnySupabase } from "@/lib/supabase/server"
import type { TeamRole } from "@/types/knowledge"
import {
  readFeedbackSummary,
  readLibraryCounts,
  readMemberCount,
  readRecentQuestions,
  type AppDatum,
} from "@/lib/voice/app-data"
import { matchLibraryFile } from "@/lib/voice/library-match"
import {
  LIBRARY_HEALTH_SUMMARY_PATH,
  LIBRARY_SUMMARY_ADMIN_ONLY,
  LIBRARY_SUMMARY_UNAVAILABLE,
  libraryHealthSummaryUrl,
  parseLibraryHealthSummary,
  speakLibraryHealthSummary,
} from "@/lib/voice/library-summary"
import { viewForAppDatum } from "@/lib/voice/screens"

export const dynamic = "force-dynamic"

const LIST_LIMIT = 30

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), chatbotId: uuidSchema }),
  z.object({
    action: z.literal("open"),
    chatbotId: uuidSchema,
    titulo: z.string().trim().min(1).max(300),
  }),
  z.object({
    action: z.literal("remember"),
    chatbotId: uuidSchema,
    perfil: z.string().trim().min(1).max(80),
  }),
  z.object({
    action: z.literal("app"),
    chatbotId: uuidSchema,
    dato: z.enum(["miembros", "preguntas", "retroalimentacion", "salud"]),
  }),
  z.object({
    action: z.literal("biblioteca"),
    chatbotId: uuidSchema,
  }),
])

/**
 * Library actions for an in-progress call: list documents, open one, or
 * remember the caller's entity type. Search stays on POST /api/voice/search.
 */
export async function POST(req: NextRequest) {
  try {
    const body = bodySchema.parse(await req.json())
    const { supabase, user } = await requireUser()
    const { chatbot, role } = await requireChatbotAccess(
      supabase,
      user.id,
      body.chatbotId,
      "member"
    )

    switch (body.action) {
      case "list":
        return NextResponse.json(await listDocuments(supabase, chatbot.id))
      case "open":
        return NextResponse.json(await openDocument(supabase, chatbot.id, body.titulo))
      case "remember":
        return NextResponse.json(
          await rememberProfile(supabase, user.id, chatbot.id, chatbot.audience_options ?? [], body.perfil)
        )
      case "app":
        return NextResponse.json(
          await readApp(supabase, user.id, chatbot.id, chatbot.team_id, role, body.dato)
        )
      case "biblioteca":
        return NextResponse.json(await readLibrarySummary(req, role, chatbot.id))
      default: {
        const unreachable: never = body
        return unreachable
      }
    }
  } catch (error) {
    return errorResponse(error, "POST /api/voice/action")
  }
}

async function readApp(
  supabase: AnySupabase,
  userId: string,
  chatbotId: string,
  teamId: string,
  role: TeamRole,
  dato: AppDatum
) {
  let respuesta: string
  switch (dato) {
    case "miembros":
      respuesta = await readMemberCount(supabase, teamId, role)
      break
    case "preguntas":
      respuesta = await readRecentQuestions(supabase, chatbotId, userId, role)
      break
    case "retroalimentacion":
      respuesta = await readFeedbackSummary(supabase, chatbotId, userId, role)
      break
    case "salud":
      respuesta = await readLibraryCounts(supabase, chatbotId)
      break
    default: {
      const unreachable: never = dato
      return unreachable
    }
  }
  return {
    output: JSON.stringify({ respuesta }),
    navigate: viewForAppDatum(dato, role === "admin"),
  }
}

async function readLibrarySummary(req: NextRequest, role: TeamRole, chatbotId: string) {
  if (role !== "admin") {
    return { output: JSON.stringify({ respuesta: LIBRARY_SUMMARY_ADMIN_ONLY }) }
  }
  const url = libraryHealthSummaryUrl(req.nextUrl.origin, chatbotId)
  const cookie = req.headers.get("cookie")
  try {
    const res = await fetch(url, {
      headers: cookie ? { cookie } : {},
      cache: "no-store",
    })
    const type = res.headers.get("content-type") ?? ""
    const payload = type.includes("json") ? await res.json() : null
    if (!res.ok || payload == null) {
      console.error("voice library summary", LIBRARY_HEALTH_SUMMARY_PATH, res.status)
      return {
        output: JSON.stringify({ respuesta: LIBRARY_SUMMARY_UNAVAILABLE }),
        navigate: "biblioteca",
      }
    }
    return {
      output: JSON.stringify({
        respuesta: speakLibraryHealthSummary(parseLibraryHealthSummary(payload)),
      }),
      navigate: "biblioteca",
    }
  } catch (error) {
    console.error("voice library summary", error)
    return {
      output: JSON.stringify({ respuesta: LIBRARY_SUMMARY_UNAVAILABLE }),
      navigate: "biblioteca",
    }
  }
}

async function listDocuments(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  chatbotId: string
) {
  const { data, error } = await supabase
    .from("files")
    .select("file_name, outdated")
    .eq("chatbot_id", chatbotId)
    .order("file_name", { ascending: true })
  if (error) throw error
  const rows = data ?? []
  const shown = rows.slice(0, LIST_LIMIT).map((row) => ({
    titulo: String(row.file_name ?? "Documento"),
    desactualizado: Boolean(row.outdated),
  }))
  const extra = rows.length - shown.length
  const respuesta =
    rows.length === 0
      ? "La biblioteca no tiene documentos todavía."
      : `Hay ${rows.length} documentos. Di el total y, salvo que pidan la lista completa, como máximo ocho títulos.`
  return {
    output: JSON.stringify({
      respuesta,
      total: rows.length,
      documentos: shown,
      omitidos: extra > 0 ? extra : 0,
    }),
  }
}

async function openDocument(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  chatbotId: string,
  titulo: string
) {
  const { data, error } = await supabase
    .from("files")
    .select("id, file_name, outdated")
    .eq("chatbot_id", chatbotId)
  if (error) throw error
  const files = (data ?? []).map((row) => ({
    id: String(row.id),
    file_name: String(row.file_name ?? ""),
    outdated: Boolean(row.outdated),
  }))
  const { match, ambiguous } = matchLibraryFile(files, titulo)
  if (!match) {
    const respuesta =
      ambiguous.length > 0
        ? `Hay varios documentos parecidos: ${ambiguous.join(", ")}. Pregunta cuál abrir.`
        : "No encontré ese documento en la biblioteca. Pide el título de nuevo."
    return { output: JSON.stringify({ respuesta }) }
  }
  return {
    output: JSON.stringify({
      respuesta: `Abrí «${match.file_name}» en pantalla. Dilo en una frase.`,
      titulo: match.file_name,
    }),
    document: {
      title: match.file_name,
      url: `/api/files/${match.id}/download`,
      outdated: match.outdated === true,
    },
  }
}

async function rememberProfile(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
  chatbotId: string,
  options: string[],
  perfil: string
) {
  if (options.length === 0) {
    return {
      output: JSON.stringify({
        respuesta: "Este asistente no guarda un tipo de entidad.",
      }),
      entity: null as string | null,
    }
  }
  const option = findOption(options, perfil)
  if (!option) {
    return {
      output: JSON.stringify({
        respuesta: `No reconozco ese tipo de entidad. Las opciones son: ${options.join(", ")}.`,
      }),
      entity: null as string | null,
    }
  }
  await savePrefs(supabase, userId, chatbotId, {
    entity_type: option,
    entity_prompt_dismissed: true,
  })
  return {
    output: JSON.stringify({
      respuesta: `Quedó guardado el tipo de entidad «${option}». Confírmalo en una frase.`,
    }),
    entity: option,
  }
}
