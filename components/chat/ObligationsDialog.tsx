"use client"

import { useState } from "react"
import { Loader2, Table2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import {
  obligationsToMarkdown,
  obligationsToTsv,
  type ObligationRow,
} from "@/lib/chat/obligations"

export function ObligationsButton({
  chatbotId,
  messageId,
}: {
  chatbotId?: string
  messageId?: string
}) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<ObligationRow[] | null>(null)
  const [loading, setLoading] = useState(false)

  const openTable = async () => {
    if (!chatbotId || !messageId) return
    setOpen(true)
    if (rows) return
    setLoading(true)
    try {
      const response = await fetch("/api/obligations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatbotId, messageId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || "No se pudo armar la tabla.")
      setRows(payload.rows ?? [])
    } catch (error) {
      toast({ description: (error as Error).message, variant: "destructive" })
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  const copy = async () => {
    if (!rows?.length) return
    const text = `${obligationsToTsv(rows)}\n\n${obligationsToMarkdown(rows)}`
    try {
      await navigator.clipboard.writeText(text)
      toast({ description: "Tabla copiada.", duration: 2000 })
    } catch {
      toast({ description: "No se pudo copiar.", variant: "destructive" })
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-gray-600"
        onClick={openTable}
        disabled={!chatbotId || !messageId}
        data-testid="obligations-button"
      >
        <Table2 className="mr-1 h-4 w-4" />
        Obligaciones
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-auto">
          <DialogHeader>
            <DialogTitle>Obligaciones, plazos y sanciones</DialogTitle>
            <DialogDescription>
              Sale de esta respuesta. No agrega datos que el texto no diga.
            </DialogDescription>
          </DialogHeader>
          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Leyendo la respuesta…
            </p>
          )}
          {!loading && rows && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Esta respuesta no menciona obligaciones, plazos o sanciones que se
              puedan poner en una tabla.
            </p>
          )}
          {!loading && rows && rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm" data-testid="obligations-table">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2 pr-3 font-medium">Obligación</th>
                      <th className="py-2 pr-3 font-medium">Plazo</th>
                      <th className="py-2 font-medium">Sanción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={`${index}-${row.obligation.slice(0, 24)}`} className="border-b align-top">
                        <td className="py-2 pr-3">{row.obligation || "—"}</td>
                        <td className="py-2 pr-3">{row.deadline || "—"}</td>
                        <td className="py-2">{row.sanction || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button type="button" size="sm" onClick={copy}>
                Copiar tabla
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
