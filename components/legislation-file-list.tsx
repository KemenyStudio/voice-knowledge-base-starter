"use client";
import { useState, useEffect, memo } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  FileIcon,
  Trash2Icon,
  Loader2Icon,
  EditIcon,
  RefreshCwIcon,
  UsersIcon,
  FlagIcon,
  SearchIcon,
  ChevronDownIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import FileUpload from "@/components/FileUpload";
import { DocumentPreviewDialog } from "@/components/chat/DocumentPreview";
import { Checkbox } from "@/components/ui/checkbox";
import type { AudienceStatus, SyncStatus } from "@/types/knowledge";

interface LegislationFile {
  id: string;
  file_name: string;
  uploaded_at: string;
  sync_status?: SyncStatus;
  sync_error?: string | null;
  audience?: string[];
  audience_suggested?: string[];
  audience_status?: AudienceStatus;
  outdated?: boolean;
  outdated_note?: string | null;
  index_health_score?: number | null;
  index_health?: {
    score: number | null;
    verdict: "good" | "review" | "unknown";
    reasons: string[];
  } | null;
  metadata?: {
    target_tag?: string[];
    entity_tag?: string[];
    type_tag?: string;
    context?: string;
  } | null;
}

interface LegislationFileListProps {
  files: LegislationFile[];
  chatbotId: string;
  /** Only admins can edit, delete or re-index documents. */
  isAdmin: boolean;
  /** Called when a document is still indexing so the parent can re-fetch. */
  onRefresh?: () => void;
  /** Entity types of the assistant; when set, the audience column shows them. */
  audienceOptions?: string[];
  /** Filters the list to a name (set by the health panel). */
  searchSeed?: { term: string; n: number } | null;
}

type DocStatusFilter = "all" | "ready" | "indexing" | "failed" | "outdated";
type AudienceListFilter = "all" | "confirmed" | "suggested" | "unclassified";

function matchesStatus(file: LegislationFile, filter: DocStatusFilter): boolean {
  const status = file.sync_status ?? "external";
  switch (filter) {
    case "all":
      return true;
    case "ready":
      return status === "ready" || status === "external";
    case "indexing":
      return status === "processing" || status === "pending";
    case "failed":
      return status === "failed";
    case "outdated":
      return Boolean(file.outdated);
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
}

function matchesAudience(file: LegislationFile, filter: AudienceListFilter): boolean {
  const status = file.audience_status ?? "unclassified";
  switch (filter) {
    case "all":
      return true;
    case "confirmed":
    case "suggested":
    case "unclassified":
      return status === filter;
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
}

const scanBadgeClass = "whitespace-nowrap px-1.5 py-0 text-xs font-medium leading-4"

function tagSummary(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items[0]} y ${items.length - 1} más`;
}

function TagSummary({
  label,
  items,
  empty,
  badge,
}: {
  label: string;
  items: string[];
  empty: string;
  badge?: { text: string; className: string };
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {badge && (
          <Badge variant="secondary" className={`${scanBadgeClass} ${badge.className}`}>
            {badge.text}
          </Badge>
        )}
        <span className="text-sm text-muted-foreground">{empty}</span>
      </div>
    );
  }

  const summary = tagSummary(items);
  const renderList = () => (
    <ul className="flex flex-wrap gap-1">
      {items.map((item) => (
        <li key={item}>
          <Badge variant="outline" className={`${scanBadgeClass} font-normal`}>
            {item}
          </Badge>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="max-w-[16rem]">
      <HoverCard openDelay={200} closeDelay={80}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            className="flex max-w-full items-center gap-1.5 rounded-md text-left text-sm leading-snug hover:bg-muted/70"
            aria-expanded={expanded}
            aria-label={`${label}: ${summary}. Clic para ${expanded ? "ocultar" : "ver"} la lista.`}
            onClick={() => setExpanded((value) => !value)}
          >
            {badge && (
              <Badge variant="secondary" className={`shrink-0 ${scanBadgeClass} ${badge.className}`}>
                {badge.text}
              </Badge>
            )}
            <span className="truncate">{summary}</span>
          </button>
        </HoverCardTrigger>
        <HoverCardContent align="start" className="w-80">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {label} · {items.length}
          </p>
          {renderList()}
        </HoverCardContent>
      </HoverCard>
      {expanded && <div className="mt-1.5">{renderList()}</div>}
    </div>
  );
}

function AudienceCell({ file }: { file: LegislationFile }) {
  const status = file.audience_status ?? "unclassified";
  const directed = file.metadata?.target_tag ?? [];
  if (status === "confirmed") {
    const items = directed.length > 0 ? directed : file.audience ?? [];
    return (
      <TagSummary
        label="Audiencia"
        items={items}
        empty="Todas las audiencias"
      />
    );
  }
  if (status === "suggested") {
    return (
      <TagSummary
        label="Audiencia sugerida"
        items={file.audience_suggested ?? []}
        empty="Todas"
        badge={{ text: "Sugerida", className: "bg-amber-100 text-amber-800" }}
      />
    );
  }
  return <span className="text-sm leading-snug text-muted-foreground">Sin clasificar</span>;
}

function IndexHealthBadge({ file }: { file: LegislationFile }) {
  const health = file.index_health;
  const score = file.index_health_score ?? health?.score ?? null;
  const verdict = health?.verdict;
  if (score == null || verdict == null || verdict === "unknown") {
    return (
      <span className="text-sm leading-snug text-muted-foreground" title={health?.reasons?.[0]}>
        Sin evaluar
      </span>
    );
  }
  const label = verdict === "good" ? "Bueno" : score < 50 ? "Débil" : "Revisar";
  const className =
    verdict === "good"
      ? "bg-green-100 text-green-800"
      : score < 50
        ? "bg-red-100 text-red-800"
        : "bg-amber-100 text-amber-800";
  const reasons = health?.reasons?.length ? health.reasons : ["Buen texto para buscar."];
  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>
        <Badge
          variant="secondary"
          className={`cursor-default ${scanBadgeClass} ${className}`}
          data-testid="index-health-score"
        >
          {score} · {label}
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Calidad para el índice</p>
        <ul className="list-disc pl-4 text-sm">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
}

const STATUS_LABEL: Record<SyncStatus, { label: string; className: string }> = {
  ready: { label: "Listo", className: "bg-green-100 text-green-800" },
  external: { label: "Listo", className: "bg-green-100 text-green-800" },
  processing: { label: "Indexando…", className: "bg-blue-100 text-blue-800" },
  pending: { label: "Pendiente", className: "bg-slate-100 text-slate-700" },
  failed: { label: "Error", className: "bg-red-100 text-red-800" },
};

export default memo<LegislationFileListProps>(function LegislationFileList({
  files,
  chatbotId,
  isAdmin,
  onRefresh,
  audienceOptions = [],
  searchSeed = null,
}) {
  const [deletingFiles, setDeletingFiles] = useState<{ [key: string]: boolean; }>({});
  const [syncingFiles, setSyncingFiles] = useState<{ [key: string]: boolean; }>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<DocStatusFilter>("all");
  const [audienceFilter, setAudienceFilter] = useState<AudienceListFilter>("all");
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: string; } | null>(null);
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const [fileToEdit, setFileToEdit] = useState<LegislationFile | null>(null);
  const [fileList, setFileList] = useState(files);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [audienceFile, setAudienceFile] = useState<LegislationFile | null>(null);
  const [audienceDraft, setAudienceDraft] = useState<string[]>([]);
  const [savingAudience, setSavingAudience] = useState(false);
  const [previewFile, setPreviewFile] = useState<LegislationFile | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    setFileList(files);
  }, [files]);

  useEffect(() => {
    if (searchSeed) setSearchTerm(searchSeed.term);
  }, [searchSeed]);

  const toggleOutdated = async (file: LegislationFile) => {
    const next = !file.outdated;
    let note = "";
    if (next) {
      const answer = window.prompt("Nota opcional (por ejemplo, qué documento lo reemplaza):", "");
      if (answer === null) return;
      note = answer;
    }
    try {
      const response = await fetch(`/api/files/${file.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outdated: next, note }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "No se pudo actualizar");
      setFileList((prev) => prev.map((f) => (f.id === file.id ? { ...f, ...result.file } : f)));
      toast({ description: next ? "Marcado como desactualizado." : "Marca de desactualizado quitada." });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo actualizar",
        variant: "destructive",
      });
    }
  };

  // While something is indexing, poll the list every few seconds.
  const hasProcessing = fileList.some((f) => f.sync_status === "processing");
  useEffect(() => {
    if (!hasProcessing || !onRefresh) return;
    const timer = setInterval(onRefresh, 5000);
    return () => clearInterval(timer);
  }, [hasProcessing, onRefresh]);

  const sortedFiles = [...fileList]
    .filter((file) => file.file_name.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter((file) => matchesStatus(file, statusFilter))
    .filter((file) => (audienceOptions.length > 0 ? matchesAudience(file, audienceFilter) : true))
    .sort((a, b) => {
      if (!sortConfig) return 0;
      const { key, direction } = sortConfig;
      const isAscending = direction === "asc";

      if (key === "file_name") {
        return isAscending
          ? a.file_name.localeCompare(b.file_name)
          : b.file_name.localeCompare(a.file_name);
      }

      if (key === "uploaded_at") {
        return isAscending
          ? new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime()
          : new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime();
      }

      return 0;
    });

  const handleSort = (key: string) => {
    setSortConfig((prevConfig) => {
      if (prevConfig?.key === key) {
        return { key, direction: prevConfig.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: "asc" };
    });
  };

  const handleDeleteFile = async (fileId: string) => {
    setDeletingFiles(prev => ({ ...prev, [fileId]: true }));

    try {
      const response = await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || 'Error al eliminar el archivo');
      }

      setFileList(prev => prev.filter(file => file.id !== fileId));

      toast({
        title: "Archivo eliminado",
        description: result.warning ?? "El archivo ha sido eliminado correctamente",
        duration: result.warning ? 8000 : 3000,
      });
    } catch (error) {
      console.error('Error:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo eliminar el archivo",
        duration: 5000,
        variant: "destructive",
      });
    } finally {
      setDeletingFiles(prev => ({ ...prev, [fileId]: false }));
    }
  };

  const handleRetrySync = async (fileId: string) => {
    setSyncingFiles(prev => ({ ...prev, [fileId]: true }));
    try {
      const response = await fetch(`/api/files/${fileId}/sync`, { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No se pudo reindexar');
      toast({ title: "Reindexado", description: "El documento se está indexando de nuevo." });
      onRefresh?.();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo reindexar",
        variant: "destructive",
      });
    } finally {
      setSyncingFiles(prev => ({ ...prev, [fileId]: false }));
    }
  };

  const openAudienceEditor = (file: LegislationFile) => {
    setAudienceFile(file);
    setAudienceDraft(
      file.audience_status === "suggested" ? file.audience_suggested ?? [] : file.audience ?? []
    );
  };

  const saveAudience = async () => {
    if (!audienceFile) return;
    setSavingAudience(true);
    try {
      const response = await fetch("/api/files/audience", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set",
          chatbotId,
          fileId: audienceFile.id,
          audience: audienceDraft,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "No se pudo guardar");
      setFileList((prev) =>
        prev.map((f) => (f.id === audienceFile.id ? { ...f, ...result.file } : f))
      );
      toast({
        title: "Audiencia guardada",
        description: result.warning,
        variant: result.warning ? "destructive" : "default",
      });
      setAudienceFile(null);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo guardar",
        variant: "destructive",
      });
    } finally {
      setSavingAudience(false);
    }
  };

  const handleEditComplete = async () => {
    if (fileToEdit) {
      try {
        const response = await fetch(`/api/files/${fileToEdit.id}`);
        if (!response.ok) {
          throw new Error('Error al obtener los datos actualizados del archivo');
        }
        const updatedFile = await response.json();

        setFileList(prev =>
          prev.map(file => (file.id === fileToEdit.id ? updatedFile : file))
        );

        toast({
          title: "Documento actualizado",
          description: "Los metadatos han sido actualizados correctamente",
          duration: 3000
        });
      } catch (error) {
        console.error('Error:', error);
        toast({
          title: "Error",
          description: "No se pudieron actualizar los datos del archivo",
          duration: 3000,
          variant: "destructive",
        });
      }
    }

    setIsEditDialogOpen(false);
    setFileToEdit(null);
  };

  const filtersActive = statusFilter !== "all" || audienceFilter !== "all" || searchTerm.trim().length > 0;

  return (
    <>
      <div className="sticky top-0 z-10 space-y-2 bg-background/95 pb-3 pt-1 backdrop-blur">
        <label className="block" htmlFor="library-search">
          <span className="mb-1.5 flex items-center gap-2 text-sm font-medium">
            <SearchIcon className="h-4 w-4 text-blue-600" aria-hidden />
            Buscar documentos
          </span>
          <Input
            id="library-search"
            type="search"
            placeholder="Escribe parte del nombre…"
            className="h-11"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Estado</span>
            <select
              aria-label="Filtrar por estado"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as DocStatusFilter)}
            >
              <option value="all">Todos</option>
              <option value="ready">Listos</option>
              <option value="indexing">Indexando o pendientes</option>
              <option value="failed">Con error</option>
              <option value="outdated">Desactualizados</option>
            </select>
          </label>
          {audienceOptions.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Audiencia</span>
              <select
                aria-label="Filtrar por audiencia"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={audienceFilter}
                onChange={(event) => setAudienceFilter(event.target.value as AudienceListFilter)}
              >
                <option value="all">Todas</option>
                <option value="confirmed">Confirmada</option>
                <option value="suggested">Sugerida</option>
                <option value="unclassified">Sin clasificar</option>
              </select>
            </label>
          )}
          {filtersActive && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchTerm("");
                setStatusFilter("all");
                setAudienceFilter("all");
              }}
            >
              Limpiar filtros
            </Button>
          )}
          <span className="ml-auto text-sm text-muted-foreground">
            {sortedFiles.length} de {fileList.length}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
      <Table className="mt-2 w-full min-w-[880px] text-sm [&_td]:px-3 [&_td]:py-3 [&_th]:h-8 [&_th]:px-3 [&_th]:text-[11px] [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-wide">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[34%] cursor-pointer text-left" onClick={() => handleSort("file_name")}>
              Nombre {sortConfig?.key === "file_name" ? (sortConfig.direction === "asc" ? "↑" : "↓") : ""}
            </TableHead>
            <TableHead className="cursor-pointer text-left" onClick={() => handleSort("uploaded_at")}>
              Subido {sortConfig?.key === "uploaded_at" ? (sortConfig.direction === "asc" ? "↑" : "↓") : ""}
            </TableHead>
            <TableHead className="text-left">Estado</TableHead>
            {isAdmin && (
              <TableHead className="text-left" title="Qué tan bien se puede buscar dentro del documento">
                Índice
              </TableHead>
            )}
            <TableHead className="text-left">Tipo</TableHead>
            <TableHead className="text-left">{audienceOptions.length ? "Audiencia" : "Dirigido a"}</TableHead>
            <TableHead className="text-left">Fuente</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedFiles.map((file) => {
            const status = STATUS_LABEL[file.sync_status ?? "external"];
            const outdatedLabel = file.outdated ? "Quitar marca de desactualizado" : "Marcar como desactualizado";
            return (
              <TableRow key={file.id}>
                <TableCell className="max-w-md align-top">
                  <HoverCard openDelay={400}>
                    <HoverCardTrigger asChild>
                      <p className="line-clamp-2 text-sm font-medium leading-snug" title={file.file_name}>
                        {file.file_name}
                      </p>
                    </HoverCardTrigger>
                    <HoverCardContent align="start" className="w-96">
                      <p className="text-sm leading-snug">{file.file_name}</p>
                      {file.metadata?.context && (
                        <p className="mt-2 text-xs text-muted-foreground">{file.metadata.context}</p>
                      )}
                      {file.outdated_note && (
                        <p className="mt-2 text-xs text-muted-foreground">{file.outdated_note}</p>
                      )}
                    </HoverCardContent>
                  </HoverCard>
                  {file.outdated && (
                    <Badge
                      variant="secondary"
                      className={`mt-1.5 ${scanBadgeClass} bg-amber-100 text-amber-800`}
                      title={file.outdated_note ?? "Marcado como desactualizado"}
                    >
                      Desactualizado
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="align-top text-sm leading-snug text-muted-foreground">
                  {new Date(file.uploaded_at).toLocaleDateString("es-MX")}
                </TableCell>
                <TableCell className="align-top">
                  <Badge
                    variant="secondary"
                    className={`${scanBadgeClass} ${status.className}`}
                    title={file.sync_error ?? undefined}
                  >
                    {status.label}
                  </Badge>
                </TableCell>
                {isAdmin && (
                  <TableCell className="align-top">
                    <IndexHealthBadge file={file} />
                  </TableCell>
                )}
                <TableCell className="align-top">
                  <Badge variant="outline" className={`${scanBadgeClass} max-w-[10rem] truncate font-normal`}>
                    {file.metadata?.type_tag || "Sin tipo"}
                  </Badge>
                </TableCell>
                <TableCell className="align-top">
                  {audienceOptions.length > 0 ? (
                    <AudienceCell file={file} />
                  ) : (
                    <TagSummary
                      label="Dirigido a"
                      items={file.metadata?.target_tag ?? []}
                      empty="—"
                    />
                  )}
                </TableCell>
                <TableCell className="align-top">
                  <TagSummary
                    label="Fuente"
                    items={file.metadata?.entity_tag ?? []}
                    empty="—"
                  />
                </TableCell>
                <TableCell className="align-top text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={() => setPreviewFile(file)}
                    >
                      <FileIcon className="mr-1.5 h-3.5 w-3.5" />
                      Abrir
                    </Button>
                    {isAdmin && audienceOptions.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        title="Editar audiencia"
                        aria-label="Editar audiencia"
                        onClick={() => openAudienceEditor(file)}
                      >
                        <UsersIcon className="mr-1.5 h-3.5 w-3.5" />
                        Audiencia
                      </Button>
                    )}
                    {isAdmin && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" aria-label="Más acciones del documento">
                            Acciones
                            <ChevronDownIcon className="ml-1 h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          {file.sync_status === "failed" && (
                            <DropdownMenuItem
                              disabled={Boolean(syncingFiles[file.id])}
                              onClick={() => handleRetrySync(file.id)}
                            >
                              <RefreshCwIcon className="mr-2 h-4 w-4" />
                              Reintentar indexación
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => toggleOutdated(file)}>
                            <FlagIcon className="mr-2 h-4 w-4" />
                            {outdatedLabel}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setFileToEdit(file);
                              setIsEditDialogOpen(true);
                            }}
                          >
                            <EditIcon className="mr-2 h-4 w-4" />
                            Editar metadatos
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={Boolean(deletingFiles[file.id])}
                            className="text-red-600 focus:text-red-600"
                            onClick={() => setFileToDelete(file.id)}
                          >
                            {deletingFiles[file.id] ? (
                              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2Icon className="mr-2 h-4 w-4" />
                            )}
                            Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>
      {sortedFiles.length === 0 && (
        <p className="mt-6 text-center text-sm text-gray-500">
          {fileList.length === 0
            ? "Todavía no hay documentos en esta biblioteca."
            : "Ningún documento coincide con la búsqueda o los filtros."}
        </p>
      )}

      <AlertDialog open={Boolean(fileToDelete)} onOpenChange={(open) => { if (!open) setFileToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar eliminación</AlertDialogTitle>
            <AlertDialogDescription>
              El documento dejará de usarse en las respuestas y se eliminará de la biblioteca.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setFileToDelete(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (fileToDelete) { handleDeleteFile(fileToDelete); } setFileToDelete(null); }}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={Boolean(audienceFile)} onOpenChange={(open) => { if (!open) setAudienceFile(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Audiencia del documento</DialogTitle>
            <DialogDescription>
              {audienceFile?.file_name}. Marca los perfiles a los que aplica; sin marcar
              significa que aplica a todas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {audienceOptions.map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={audienceDraft.includes(option)}
                  onCheckedChange={(checked) =>
                    setAudienceDraft((prev) =>
                      checked ? [...prev, option] : prev.filter((o) => o !== option)
                    )
                  }
                />
                {option}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAudienceFile(null)}>Cancelar</Button>
            <Button onClick={saveAudience} disabled={savingAudience}>
              {savingAudience && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DocumentPreviewDialog
        title={previewFile?.file_name ?? "Documento"}
        url={previewFile ? `/api/files/${previewFile.id}/download` : null}
        onClose={() => setPreviewFile(null)}
      />

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar documento</DialogTitle>
            <DialogDescription>
              Astra propone tipo, audiencia, fuente y contexto. Edítalos y pulsa Actualizar documento para guardarlos.
            </DialogDescription>
          </DialogHeader>
          {fileToEdit && (
            <FileUpload
              chatbotId={chatbotId}
              audienceOptions={audienceOptions}
              onUploadComplete={handleEditComplete}
              initialData={fileToEdit}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
});
