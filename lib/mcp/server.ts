import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { ToolError, scrub } from "@/lib/mcp/errors"
import {
  feedbackSummary,
  getDocument,
  listAssistants,
  listDocuments,
  searchLibrary,
} from "@/lib/mcp/library"

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  }
}

async function guard(work: () => Promise<unknown>) {
  try {
    return textResult(await work())
  } catch (error) {
    if (!(error instanceof ToolError)) {
      console.error("[mcp] tool", scrub(error instanceof Error ? error.message : "tool failed"))
    }
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: error instanceof ToolError ? error.message : "Error interno",
        },
      ],
    }
  }
}

/** MCP server bound to one team. Tools never receive a team id from the client. */
export function createLibraryServer(teamId: string): McpServer {
  const server = new McpServer(
    { name: "ai-search", version: "1.0.0" },
    {
      instructions:
        "Biblioteca del equipo autorizado por la API key. Las herramientas solo leen ese equipo. No pidas la clave de OpenAI ni la service role: no se comparten.",
    }
  )

  server.registerTool(
    "list_assistants",
    {
      title: "List assistants",
      description:
        "Lista los asistentes de este equipo y cuántos documentos tiene cada uno. El id se usa como assistantId en las demás herramientas.",
      annotations: READ_ONLY,
      inputSchema: {},
    },
    async () => guard(() => listAssistants(teamId))
  )

  server.registerTool(
    "search_library",
    {
      title: "Search the library",
      description:
        "Busca pasajes en la biblioteca del asistente, en el mismo índice vectorial que usa el chat. Devuelve documentos y fragmentos; no redacta una respuesta. Si el equipo tiene un solo asistente, assistantId es opcional. entityType aplica el mismo filtro de audiencia que el chat (por ejemplo Bancos o Sofipos).",
      annotations: READ_ONLY,
      inputSchema: {
        query: z.string().trim().min(2).max(500).describe("Consulta de búsqueda"),
        assistantId: z.string().uuid().optional().describe("Id del asistente"),
        entityType: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .optional()
          .describe("Tipo de entidad para filtrar la audiencia"),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(12)
          .optional()
          .describe("Máximo de documentos a devolver (1 a 12)"),
      },
    },
    async (args) =>
      guard(() =>
        searchLibrary({
          teamId,
          query: args.query,
          assistantId: args.assistantId,
          entityType: args.entityType,
          maxResults: args.maxResults,
        })
      )
  )

  server.registerTool(
    "list_documents",
    {
      title: "List documents",
      description:
        "Lista los documentos de la biblioteca de un asistente de este equipo: nombre, etiquetas, audiencia y si está marcado como desactualizado.",
      annotations: READ_ONLY,
      inputSchema: {
        assistantId: z.string().uuid().optional().describe("Id del asistente"),
        name: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .describe("Filtro por nombre, sin distinguir mayúsculas"),
        limit: z.number().int().min(1).max(100).optional().describe("Tamaño de página, máximo 100"),
        offset: z.number().int().min(0).max(10000).optional().describe("Desplazamiento de la página"),
      },
    },
    async (args) =>
      guard(() =>
        listDocuments({
          teamId,
          assistantId: args.assistantId,
          name: args.name,
          limit: args.limit,
          offset: args.offset,
        })
      )
  )

  server.registerTool(
    "get_document",
    {
      title: "Get a document",
      description:
        "Devuelve la ficha de un documento de este equipo (nombre, etiquetas, audiencia, vigencia). No incluye el archivo ni identificadores internos del índice.",
      annotations: READ_ONLY,
      inputSchema: {
        documentId: z.string().uuid().describe("Id del documento en la biblioteca"),
      },
    },
    async (args) => guard(() => getDocument(teamId, args.documentId))
  )

  server.registerTool(
    "get_feedback_summary",
    {
      title: "Feedback and eval summary",
      description:
        "Resume las evaluaciones y las calificaciones de este equipo: votos por conjunto, el resumen numérico de la corrida si existe, pulgares arriba o abajo, y cuántas respuestas quedaron sin fuentes. No incluye otros equipos, comentarios ni datos personales.",
      annotations: READ_ONLY,
      inputSchema: {
        evaluationSet: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .describe("Si se indica, solo ese conjunto de evaluación"),
      },
    },
    async (args) =>
      guard(() => feedbackSummary({ teamId, evaluationSet: args.evaluationSet }))
  )

  return server
}
