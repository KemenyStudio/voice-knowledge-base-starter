type TeamInvitationProps = {
  inviteeEmail: string;
  teamName: string;
  inviterName: string;
  invitationLink: string;
  expirationHours: number;
};

export const teamInvitationTemplate = ({
  inviteeEmail,
  teamName,
  inviterName,
  invitationLink,
  expirationHours
}: TeamInvitationProps) => {
  return {
    subject: `Invitación para unirte al equipo ${teamName}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Invitación a equipo</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #2563eb; margin-bottom: 24px;">Te han invitado a unirte a un equipo</h1>
            
            <p>Hola,</p>
            
            <p><strong>${inviterName}</strong> te ha invitado a unirte al equipo.</p>
            
            <div style="margin: 32px 0; text-align: center;">
              <a href="${invitationLink}" 
                 style="background-color: #2563eb; 
                        color: white; 
                        padding: 12px 24px; 
                        text-decoration: none; 
                        border-radius: 6px; 
                        display: inline-block;
                        font-size: 16px;
                        font-weight: bold;
                        margin: 0 auto;">
                Aceptar invitación
              </a>
              <p style="margin-top: 16px; color: #666; font-size: 14px;">
                Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
                <span style="word-break: break-all;">${invitationLink}</span>
              </p>
            </div>
            
            <p style="color: #666; font-size: 14px;">
              Este enlace expirará en ${expirationHours} horas. 
              Si no solicitaste esta invitación, puedes ignorar este correo.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
            
            <p style="color: #666; font-size: 12px;">
              Este es un correo automático, por favor no respondas a este mensaje.
            </p>
          </div>
        </body>
      </html>
    `
  };
};