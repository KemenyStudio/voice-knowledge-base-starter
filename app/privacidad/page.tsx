import { appName } from "@/app/config/assistant-defaults"
import { LegalDocument } from "@/components/LegalDocument"

export const metadata = { title: `Privacidad · ${appName}` }

export default function PrivacidadPage() {
  return (
    <LegalDocument title="Aviso de privacidad">
      <p>
        {appName} guarda lo necesario para que el equipo use el asistente: el correo
        de la cuenta, las preguntas, las respuestas, las calificaciones y los
        documentos que un administrador sube a la biblioteca.
      </p>
      <p>
        Los administradores del equipo pueden ver qué se pregunta, qué respuestas
        volvieron sin fuentes y qué documentos nadie ha citado. Eso sirve para
        mejorar la biblioteca. No se muestra a quien no administra el equipo.
      </p>
      <p>
        Las preguntas se envían al proveedor del modelo para buscar en los
        documentos del equipo y redactar la respuesta. Los archivos se almacenan
        en la infraestructura del servicio. No vendemos datos personales.
      </p>
      <p>
        Para corregir o pedir acceso a tus datos, escribe al administrador que te
        invitó. Esa persona administra la membresía del equipo.
      </p>
    </LegalDocument>
  )
}
