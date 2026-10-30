"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { Library } from "lucide-react"
import { motion } from "framer-motion"

import FileUpload from "@/components/FileUpload"
import ChangeAlertsPanel from "@/components/ChangeAlertsPanel"
import { SourceWatchPanel } from "@/components/SourceWatchPanel"
import LibraryHealthPanel from "@/components/LibraryHealthPanel"
import LibraryStatusStrip from "@/components/LibraryStatusStrip"
import LegislationFileList from "@/components/legislation-file-list"
import { useToast } from "@/hooks/use-toast"
import {
  fillEmptyDocumentMetadata,
  fillMetadataMessage,
} from "@/lib/knowledge/fill-metadata"
import {
  audienceLabelMessage,
  labelAudiencesWithAi,
} from "@/lib/knowledge/label-audiences"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { AudienceStatus, SyncStatus } from "@/types/knowledge"

interface LibraryFile {
  id: string
  file_name: string
  uploaded_at: string
  sync_status?: SyncStatus
  sync_error?: string | null
  audience?: string[]
  audience_suggested?: string[]
  audience_status?: AudienceStatus
  outdated?: boolean
  outdated_note?: string | null
  index_health_score?: number | null
  index_health?: {
    score: number | null
    verdict: "good" | "review" | "unknown"
    reasons: string[]
    canUpload?: boolean
  } | null
  metadata?: {
    target_tag?: string[]
    entity_tag?: string[]
    type_tag?: string
  } | null
}

const BibliotecaView = memo(function BibliotecaView({
  chatbotId,
  isAdmin,
}: {
  chatbotId: string
  isAdmin: boolean
}) {
  const [files, setFiles] = useState<LibraryFile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false)
  const [loadCount, setLoadCount] = useState(0)
  const [searchSeed, setSearchSeed] = useState<{ term: string; n: number } | null>(null)
  const [scoringIndex, setScoringIndex] = useState(false)
  const scoringStarted = useRef(false)
  const [audienceOptions, setAudienceOptions] = useState<string[]>([])
  const [actionBusy, setActionBusy] = useState<
    "suggest" | "accept" | "tags" | "metadata" | null
  >(null)
  const [scanSignal, setScanSignal] = useState(0)
  const { toast } = useToast()

  useEffect(() => {
    let cancelled = false
    fetch(`/api/chatbots/${chatbotId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setAudienceOptions(data.audience_options ?? [])
      })
      .catch((error) => console.error("Error:", error))
    return () => {
      cancelled = true
    }
  }, [chatbotId])

  const fetchFiles = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/files?chatbotId=${encodeURIComponent(chatbotId)}`,
        { cache: "no-store" }
      )
      if (!response.ok) throw new Error("Error al cargar los archivos")
      const data = await response.json()
      setFiles(Array.isArray(data) ? data : [])
      setLoadCount((n) => n + 1)
    } catch (error) {
      console.error("Error:", error)
    } finally {
      setIsLoading(false)
    }
  }, [chatbotId])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  useEffect(() => {
    scoringStarted.current = false
  }, [chatbotId])

  useEffect(() => {
    if (!isAdmin || isLoading || scoringStarted.current) return
    if (!files.some((file) => file.index_health == null)) return
    scoringStarted.current = true
    let cancelled = false
    setScoringIndex(true)
    const scorePending = async () => {
      try {
        for (let round = 0; round < 50 && !cancelled; round += 1) {
          const response = await fetch("/api/files/index-health", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatbotId }),
          })
          const data = await response.json().catch(() => ({}))
          if (!response.ok || !data.scored || data.remaining === 0) break
        }
      } catch (error) {
        console.error("Error:", error)
      } finally {
        if (!cancelled) {
          setScoringIndex(false)
          void fetchFiles()
        }
      }
    }
    void scorePending()
    return () => {
      cancelled = true
    }
  }, [chatbotId, fetchFiles, files, isAdmin, isLoading])

  const confirmed = files.filter((file) => file.audience_status === "confirmed").length
  const suggested = files.filter((file) => file.audience_status === "suggested").length
  const unclassified = files.length - confirmed - suggested
  const classifiable = files.filter(
    (file) =>
      file.sync_status === "ready" &&
      (!(file.metadata?.target_tag?.length) ||
        (file.audience_status ?? "unclassified") === "unclassified")
  ).length

  const runAudience = async (
    kind: "suggest" | "accept" | "tags" | "metadata",
    action: () => Promise<string>
  ) => {
    setActionBusy(kind)
    try {
      toast({ description: await action() })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error",
        variant: "destructive",
      })
    } finally {
      setActionBusy(null)
      void fetchFiles()
    }
  }

  const postAudience = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/files/audience", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatbotId, ...body }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || "No se pudo completar la acción")
    return data as { imported?: number; unmatched?: number; accepted?: number }
  }

  return (
    <motion.div
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg dark:bg-black sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="flex h-full flex-col">
        <CardHeader className="flex flex-col gap-3 space-y-0 p-4 pb-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex min-w-0 items-center gap-3 text-xl font-bold sm:text-2xl">
            <Library className="h-6 w-6 text-blue-500" />
            Biblioteca
          </CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-hidden p-4 pt-2">
          <ScrollArea className="h-full">
            {isLoading ? (
              <div className="flex h-64 items-center justify-center">
                <p>Cargando archivos...</p>
              </div>
            ) : (
              <>
              {isAdmin ? (
                <div className="mb-3 overflow-hidden rounded-lg border bg-muted/30">
                  <LibraryStatusStrip
                    chatbotId={chatbotId}
                    refreshKey={loadCount}
                    busy={actionBusy}
                    canSuggest={classifiable > 0}
                    canAccept={suggested > 0}
                    canImport={unclassified > 0}
                    suggested={suggested}
                    onUpload={() => setIsUploadDialogOpen(true)}
                    onSuggest={() =>
                      void runAudience("suggest", async () => {
                        const { labeled, failed } = await labelAudiencesWithAi(chatbotId)
                        return audienceLabelMessage(labeled, failed)
                      })
                    }
                    onAccept={() =>
                      void runAudience("accept", async () => {
                        const data = await postAudience({ action: "accept" })
                        return `${data.accepted ?? 0} sugerencias aceptadas.`
                      })
                    }
                    onImportTags={() =>
                      void runAudience("tags", async () => {
                        const data = await postAudience({ action: "from_tags" })
                        return `${data.imported ?? 0} documentos clasificados desde sus etiquetas; ${data.unmatched ?? 0} sin coincidencia.`
                      })
                    }
                    onFillMetadata={() =>
                      void runAudience("metadata", async () => {
                        const result = await fillEmptyDocumentMetadata(chatbotId)
                        return fillMetadataMessage(result)
                      })
                    }
                    onScan={() => setScanSignal((value) => value + 1)}
                  />
                  <SourceWatchPanel
                    chatbotId={chatbotId}
                    scanSignal={scanSignal}
                    onChanged={fetchFiles}
                  />
                  <LibraryHealthPanel
                    chatbotId={chatbotId}
                    refreshKey={loadCount}
                    density="row"
                    onChanged={fetchFiles}
                    onShowFile={(term) =>
                      setSearchSeed((prev) => ({ term, n: (prev?.n ?? 0) + 1 }))
                    }
                  />
                  <ChangeAlertsPanel
                    chatbotId={chatbotId}
                    files={files}
                    refreshKey={loadCount}
                    density="row"
                    onChanged={fetchFiles}
                  />
                </div>
              ) : (
                <p className="mb-3 text-sm text-muted-foreground">
                  {files.length === 1 ? "1 documento" : `${files.length} documentos`}
                </p>
              )}
              {isAdmin && scoringIndex && (
                <p className="mb-2 text-sm text-muted-foreground">
                  Evaluando qué tan bien se puede buscar en cada documento…
                </p>
              )}
              <LegislationFileList
                audienceOptions={audienceOptions}
                searchSeed={searchSeed}
                files={files}
                chatbotId={chatbotId}
                isAdmin={isAdmin}
                onRefresh={fetchFiles}
              />
              </>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Subir documento</DialogTitle>
            <DialogDescription>
              Selecciona un archivo para subir a la biblioteca.
            </DialogDescription>
          </DialogHeader>
          <FileUpload
            chatbotId={chatbotId}
            audienceOptions={audienceOptions}
            onUploadComplete={() => {
              fetchFiles()
              setIsUploadDialogOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
    </motion.div>
  )
})

export default BibliotecaView
