"use client"

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from "@/hooks/use-toast"
import { getDefaultChatbot } from '@/app/actions/user';
import Link from 'next/link';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { LegalLinks } from '@/components/LegalLinks';
import { authErrorMessage } from '@/lib/auth/messages';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginDisabled, setLoginDisabled] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClientComponentClient();
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setLoginDisabled(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.status === 429) {
          toast({
            title: "Demasiados intentos",
            description: "Demasiados intentos de inicio de sesión. Espera un minuto e inténtalo de nuevo.",
            variant: "destructive",
          });
          setTimeout(() => setLoginDisabled(false), 60000); // 1 minute lockout
        } else {
          toast({
            title: "Error",
            description: authErrorMessage(
              error.message,
              "No se pudo iniciar sesión. Revisa el correo y la contraseña."
            ),
            variant: "destructive",
          });
          setLoginDisabled(false);
        }
      } else {
        // Only same-site paths are honoured, never "//host" or full URLs.
        const next = searchParams.get('next');
        if (next && next.startsWith('/') && !next.startsWith('//')) {
          router.push(next);
          setLoginDisabled(false);
          return;
        }
        const defaultChatbot = await getDefaultChatbot();
        if (defaultChatbot) {
          router.push(`/chatbot/${defaultChatbot.id}`);
        } else {
          router.push("/dashboard");
        }
        setLoginDisabled(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-screen bg-gradient-to-b from-background to-secondary">
      <BrandMark className="mb-6 h-16 w-16" />
      <form onSubmit={handleLogin} className="w-full max-w-md space-y-4">
        <h1 className="text-3xl font-bold text-center mb-6">Iniciar sesión</h1>
        <Input
          type="email"
          placeholder="Correo electrónico"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={isLoading}
        />
        <div className="relative">
          <Input
            type={showPassword ? "text" : "password"}
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={isLoading}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 p-0"
            onClick={() => setShowPassword(!showPassword)}
            disabled={isLoading}
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </Button>
        </div>
        <Button type="submit" className="w-full" disabled={isLoading || loginDisabled}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Cargando...
            </>
          ) : (
            'Entrar'
          )}
        </Button>
        <div className="text-center mt-4 space-y-3">
          <Link href="/reset-password" className="text-sm text-primary hover:underline">
            ¿Olvidaste tu contraseña?
          </Link>
          <LegalLinks />
        </div>
      </form>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
