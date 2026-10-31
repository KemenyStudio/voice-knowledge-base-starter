const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

export const feedbackResolvedTemplate = ({
  assistantName,
  question,
  message,
}: {
  assistantName: string
  question: string | undefined
  message: string
}) => ({
  subject: `Revisamos tu comentario sobre ${assistantName}`,
  html: `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><title>Gracias por tu comentario</title></head>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #2563eb;">Gracias por avisarnos</h1>
      <p>Revisamos tu valoración de una respuesta de <strong>${escapeHtml(assistantName)}</strong>.</p>
      ${question ? `<p style="color:#666">Tu pregunta: «${escapeHtml(question.slice(0, 200))}»</p>` : ""}
      <p>${escapeHtml(message)}</p>
      <p style="color:#666;font-size:13px">Puedes volver a hacer la pregunta en el asistente.</p>
    </div>
  </body>
</html>`,
})
