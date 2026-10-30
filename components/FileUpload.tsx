"use client";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { DOCUMENT_TYPE_SUGGESTIONS } from "@/app/config/assistant-defaults";
import { audienceForSavedLabels, type DocumentMetadataProposal } from "@/lib/knowledge/document-metadata";
import { extractDocumentExcerpt } from "@/lib/knowledge/extract-text";
import { inspectFileBytes, type IndexHealth } from "@/lib/knowledge/index-readiness";

interface FileMetadataInput {
  target_tag?: string[];
  entity_tag?: string[];
  type_tag?: string;
  context?: string;
}

interface FileUploaderProps {
  /** Assistant (knowledge base) the document belongs to. Required for new uploads. */
  chatbotId: string;
  /** Configured audience profiles. A new sector is not forced into this list. */
  audienceOptions?: string[];
  onUploadComplete: () => void;
  initialData?: {
    id: string;
    file_name: string;
    metadata?: FileMetadataInput | null;
  };
}

const ACCEPTED_EXTENSIONS = ".pdf,.doc,.docx,.pptx,.txt,.md,.html,.json";
const TYPE_SUGGESTIONS_ID = "document-type-suggestions";

function TagInput({
  label,
  placeholder,
  tags,
  onChange,
}: {
  label: string;
  placeholder: string;
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const value = draft.trim();
    if (value && !tags.includes(value)) onChange([...tags, value]);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="flex items-center gap-1">
              {tag}
              <X
                className="h-3 w-3 cursor-pointer"
                onClick={() => onChange(tags.filter((t) => t !== tag))}
              />
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

export default function FileUpload({
  chatbotId,
  audienceOptions = [],
  onUploadComplete,
  initialData,
}: FileUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState(initialData?.file_name || "");
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "warn" | "error" } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [targets, setTargets] = useState<string[]>(initialData?.metadata?.target_tag ?? []);
  const [entities, setEntities] = useState<string[]>(initialData?.metadata?.entity_tag ?? []);
  const [tipo, setTipo] = useState<string>(initialData?.metadata?.type_tag ?? "");
  const [context, setContext] = useState(initialData?.metadata?.context ?? "");
  const [proposal, setProposal] = useState<DocumentMetadataProposal | null>(null);
  const [proposing, setProposing] = useState(false);
  const [inspection, setInspection] = useState<IndexHealth | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const draft = useRef({ fileName, tipo, targets, entities, context });
  draft.current = { fileName, tipo, targets, entities, context };
  const proposalToken = useRef(0);

  useEffect(() => {
    if (initialData) {
      setFileName(initialData.file_name || "");
      setTargets(initialData.metadata?.target_tag ?? []);
      setEntities(initialData.metadata?.entity_tag ?? []);
      setTipo(initialData.metadata?.type_tag ?? "");
      setContext(initialData.metadata?.context ?? "");
      setProposal(null);
    }
  }, [initialData]);

  useEffect(() => {
    if (!file) {
      setInspection(null);
      setInspecting(false);
      return;
    }
    let cancelled = false;
    setInspecting(true);
    setInspection(null);
    file
      .arrayBuffer()
      .then((buffer) => inspectFileBytes(file.name, new Uint8Array(buffer)))
      .then((result) => {
        if (!cancelled) setInspection(result);
      })
      .catch(() => {
        if (!cancelled) {
          setInspection({
            score: null,
            verdict: "unknown",
            reasons: ["No pudimos revisar el archivo. Puedes subirlo de todos modos."],
            canUpload: true,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setInspecting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const applyProposal = (next: DocumentMetadataProposal, onlyEmpty: boolean) => {
    const current = draft.current;
    if (!onlyEmpty || !current.tipo.trim()) setTipo(next.tipo);
    if (!onlyEmpty || current.targets.length === 0) setTargets(next.audiencia);
    if (!onlyEmpty || current.entities.length === 0) setEntities(next.fuente);
    if (!onlyEmpty || !current.context.trim()) setContext(next.contexto);
    if (!current.fileName.trim() && next.nombre.trim()) setFileName(next.nombre);
  };

  const requestProposal = async (payload: { fileId?: string; fileName?: string; text?: string }) => {
    const token = ++proposalToken.current;
    setProposing(true);
    try {
      const response = await fetch("/api/files/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "propose", chatbotId, ...payload }),
      });
      const data = await response.json().catch(() => ({}));
      if (token !== proposalToken.current) return;
      if (!response.ok) throw new Error(data.error || "Astra no pudo leer el documento");
      const next = data.proposal as DocumentMetadataProposal | null;
      setProposal(next);
      if (next) applyProposal(next, true);
    } catch (error) {
      if (token !== proposalToken.current) return;
      setProposal(null);
      setMessage({
        text: error instanceof Error ? error.message : "Astra no pudo leer el documento",
        tone: "warn",
      });
    } finally {
      if (token === proposalToken.current) setProposing(false);
    }
  };

  useEffect(() => {
    if (!initialData?.id) return;
    void requestProposal({ fileId: initialData.id });
    return () => {
      proposalToken.current += 1;
    };
    // The proposal is for this document. Later edits stay in the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbotId, initialData?.id]);

  const metadata = () => ({
    target_tag: targets,
    entity_tag: entities,
    type_tag: tipo.trim(),
    context: context.trim(),
  });

  const savedAudience = () =>
    audienceForSavedLabels(targets, audienceOptions, proposal);

  const uploadFile = async () => {
    if (!file && !initialData) return;
    setIsLoading(true);
    setMessage(null);

    try {
      if (initialData) {
        const response = await fetch(`/api/files/${initialData.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metadata: metadata(),
            fileName,
            ...(savedAudience() !== null ? { audience: savedAudience() } : {}),
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || "Error al actualizar los metadatos");
        }
        setMessage({ text: "Metadatos actualizados correctamente", tone: "ok" });
        onUploadComplete();
        return;
      }

      if (file) {
        // 1) ask the server for a one-time upload URL (checks admin access)
        const signResponse = await fetch("/api/upload/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, size: file.size, chatbotId }),
        });
        const target = await signResponse.json().catch(() => ({}));
        if (!signResponse.ok) {
          throw new Error(target.error || "No se pudo preparar la subida");
        }

        // 2) send the file straight to storage (no size limit from the server)
        const { error: storageError } = await createClientComponentClient()
          .storage.from(target.bucket)
          .uploadToSignedUrl(target.path, target.token, file);
        if (storageError) {
          throw new Error(`No se pudo subir el archivo: ${storageError.message}`);
        }

        // 3) register and index it
        const response = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            storagePath: target.path,
            chatbotId,
            metadata: metadata(),
            ...(savedAudience() !== null ? { audience: savedAudience() } : {}),
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || "No se pudo subir el archivo");
        }

        const status = result.file?.sync_status;
        setMessage(
          status === "failed"
            ? {
                text: "El archivo se guardó pero no se pudo indexar. Reintenta desde la biblioteca.",
                tone: "warn",
              }
            : status === "ready"
              ? { text: "Documento subido e indexado correctamente", tone: "ok" }
              : { text: "Documento subido. Se está indexando…", tone: "ok" }
        );
        onUploadComplete();
        if (inputRef.current) inputRef.current.value = "";
        setFile(null);
        setTargets([]);
        setEntities([]);
        setTipo("");
        setContext("");
        setProposal(null);
        setFileName("");
      }
    } catch (error) {
      console.error("Upload error:", error);
      setMessage({
        text: error instanceof Error ? error.message : "Operación fallida",
        tone: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {!initialData && (
        <div className="relative">
          <input
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            onChange={(e) => {
              const next = e.target.files?.[0] ?? null;
              setFile(next);
              setProposal(null);
              if (!next) return;
              next
                .arrayBuffer()
                .then((buffer) => extractDocumentExcerpt(next.name, new Uint8Array(buffer)))
                .then((text) => {
                  if (text.trim().length < 40) return;
                  return requestProposal({ fileName: next.name, text });
                })
                .catch(() => undefined);
            }}
            ref={inputRef}
            className="hidden"
            id="file-upload"
          />
          <label
            htmlFor="file-upload"
            className="cursor-pointer inline-flex items-center px-4 py-2 rounded-full
            bg-blue-50 text-blue-700 text-sm font-semibold
            hover:bg-blue-100 transition-colors"
          >
            Explorar archivos
          </label>
          <span className="ml-3 text-sm text-slate-500">
            {file ? file.name : "Ningún archivo seleccionado"}
          </span>
          <p className="mt-2 text-xs text-slate-400">
            Formatos: PDF, Word, PowerPoint, TXT, Markdown, HTML o JSON.
          </p>
        </div>
      )}

      {initialData && (
        <div className="relative">
          <label className="text-sm font-medium">Nombre del documento</label>
          <Input
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            className="w-full"
          />
        </div>
      )}

      <div className="space-y-4 mt-2">
        <h3 className="text-lg font-semibold text-gray-400">Metadatos (opcional)</h3>

        <div className="space-y-2">
          <label className="text-sm font-medium">Tipo de documento</label>
          <Input
            list={TYPE_SUGGESTIONS_ID}
            value={tipo}
            placeholder="Ej. Manual, Guía, Contrato"
            onChange={(e) => setTipo(e.target.value)}
          />
          <datalist id={TYPE_SUGGESTIONS_ID}>
            {DOCUMENT_TYPE_SUGGESTIONS.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        </div>

        <TagInput
          label="Audiencia"
          placeholder="Escribe y presiona Enter"
          tags={targets}
          onChange={setTargets}
        />
        <TagInput
          label="Fuente"
          placeholder="Escribe y presiona Enter"
          tags={entities}
          onChange={setEntities}
        />
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="document-context">
            Contexto
          </label>
          <Textarea
            id="document-context"
            value={context}
            placeholder="De qué trata el documento y a quién obliga"
            onChange={(e) => setContext(e.target.value)}
            className="min-h-[88px]"
          />
        </div>
      </div>

      {proposing && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Astra está leyendo el documento…
        </p>
      )}
      {proposal && (
        <div
          className="space-y-2 rounded-md border bg-slate-50 p-3 text-sm dark:bg-slate-900"
          data-testid="astra-proposal"
        >
          <p className="font-medium">Propuesta de Astra</p>
          <p>Tipo: {proposal.tipo || "—"}</p>
          <p>Audiencia: {proposal.audiencia.join(", ") || "—"}</p>
          <p>Fuente: {proposal.fuente.join(", ") || "—"}</p>
          <p>Contexto: {proposal.contexto || "—"}</p>
          {proposal.nombre.trim() && !fileName.trim() && (
            <p>Nombre: {proposal.nombre}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Los campos vacíos ya usan esta propuesta. Puedes editarla. Se guarda al
            {initialData ? " actualizar el documento." : " subir el documento."}
            {proposal.audiencia.length > 0 && proposal.audienciaFiltro.length === 0
              ? " La audiencia nueva no se fuerza a un perfil existente y no oculta el documento."
              : ""}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => applyProposal(proposal, false)}
          >
            Usar la propuesta
          </Button>
        </div>
      )}

      {!initialData && inspecting && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Revisando si el archivo sirve para el índice…
        </p>
      )}
      {!initialData && inspection?.verdict === "good" && (
        <p className="text-sm text-green-700" data-testid="index-readiness">
          Bueno para el índice{inspection.score != null ? ` (${inspection.score}/100)` : ""}.
        </p>
      )}
      {!initialData && inspection && inspection.verdict !== "good" && (
        <div
          className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
          data-testid="index-readiness"
        >
          <p className="font-medium">
            {inspection.canUpload
              ? "Conviene optimizarlo antes de indexarlo"
              : "Este archivo no se puede indexar así"}
            {inspection.score != null ? ` (${inspection.score}/100)` : ""}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {inspection.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          {inspection.canUpload && (
            <p className="mt-2">Puedes subirlo de todos modos.</p>
          )}
        </div>
      )}

      <Button
        variant="default"
        onClick={uploadFile}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white"
        disabled={
          isLoading ||
          inspecting ||
          (!file && !initialData) ||
          (inspection != null && !inspection.canUpload)
        }
      >
        {isLoading ? (
          <Loader2 className="animate-spin w-5 h-5 mx-auto" />
        ) : initialData ? (
          "Actualizar documento"
        ) : inspection?.verdict === "review" && inspection.canUpload ? (
          "Subir de todos modos"
        ) : (
          "Subir documento"
        )}
      </Button>
      {message && (
        <p
          className={cn(
            "text-center text-sm",
            message.tone === "ok" && "text-green-600",
            message.tone === "warn" && "text-amber-600",
            message.tone === "error" && "text-red-600"
          )}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
