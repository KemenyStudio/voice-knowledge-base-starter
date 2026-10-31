const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

export const changeAlertTemplate = ({
  assistantName,
  newTitle,
  oldTitle,
  link,
}: {
  assistantName: string
  newTitle: string
  oldTitle: string
  link: string
}) => ({
  subject: `Cambio en un documento que consultaste en ${assistantName}`,
  html: `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><title>Cambio en un documento</title></head>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #2563eb;">Se actualizó un documento</h1>
      <p>En <strong>${escapeHtml(assistantName)}</strong> se publicó <strong>${escapeHtml(newTitle)}</strong>, que reemplaza a <strong>${escapeHtml(oldTitle)}</strong>, un documento que apareció en tus respuestas.</p>
      <p><a href="${escapeHtml(link)}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Ver qué cambió</a></p>
      <p style="color:#666;font-size:13px">Recibes este correo porque activaste los avisos por correo en el asistente. Puedes desactivarlos desde el chat.</p>
    </div>
  </body>
</html>`,
})
