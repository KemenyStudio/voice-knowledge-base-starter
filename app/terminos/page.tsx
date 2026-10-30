import { appName } from "@/app/config/assistant-defaults"
import { LegalDocument } from "@/components/LegalDocument"

export const metadata = { title: `Términos · ${appName}` }

export default function TerminosPage() {
  return (
    <LegalDocument title="Términos de uso">
      <p>
        {appName} es un asistente de investigación sobre los documentos de un equipo.
        Las cuentas se crean solo con una invitación de un administrador. No hay
        registro abierto.
      </p>
      <p>
        Las respuestas se arman a partir de esos documentos y pueden estar incompletas
        o equivocadas. No son asesoría legal, fiscal ni financiera. Antes de usar una
        cifra, un plazo o una sanción, revisa el texto oficial.
      </p>
      <p>
        Quien sube un documento confirma que el equipo puede usarlo dentro del
        asistente. Los administradores deciden qué entra a la biblioteca y qué se
        retira. Un enlace compartido solo lo abren miembros del mismo equipo.
      </p>
      <p>
        El servicio puede dejar de estar disponible, cambiar o retirar una función.
        El uso debe respetar la ley y los documentos del equipo.
      </p>
    </LegalDocument>
  )
}
