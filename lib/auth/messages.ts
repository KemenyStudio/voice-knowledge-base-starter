const AUTH_ERRORS: Array<[RegExp, string]> = [
  [/invalid login credentials/i, "Correo o contraseña incorrectos."],
  [/email not confirmed/i, "Confirma tu correo antes de entrar."],
  [/user already registered/i, "Ese correo ya tiene una cuenta."],
  [/password should be at least/i, "La contraseña es demasiado corta."],
  [/unable to validate email address/i, "Ese correo no es válido."],
  [/invalid email/i, "Ese correo no es válido."],
  [/email rate limit exceeded/i, "Demasiados correos. Espera un momento e inténtalo de nuevo."],
  [/for security purposes/i, "Espera un momento antes de volver a intentarlo."],
  [/network|failed to fetch/i, "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo."],
  [/signup is disabled/i, "El registro público está cerrado. Pide una invitación."],
]

/**
 * Supabase Auth errors arrive in English. Show a Spanish sentence instead,
 * and keep a message that is already in Spanish.
 */
export function authErrorMessage(
  message: string | undefined | null,
  fallback: string
): string {
  if (!message) return fallback
  for (const [pattern, spanish] of AUTH_ERRORS) {
    if (pattern.test(message)) return spanish
  }
  if (/[áéíóúñ¿¡]/i.test(message)) return message
  return fallback
}
