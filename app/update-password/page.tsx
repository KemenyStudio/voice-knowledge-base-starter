"use client"

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from "@/hooks/use-toast"
import { authErrorMessage } from "@/lib/auth/messages"

export default function UpdatePassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const supabase = createClientComponentClient();
  const { toast } = useToast();

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast({
        title: "Error",
        description: "Las contraseñas no coinciden",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    
    const { error } = await supabase.auth.updateUser({
      password: password
    });

    if (error) {
      toast({
        title: "Error",
        description: authErrorMessage(
          error.message,
          "No se pudo actualizar la contraseña. Inténtalo de nuevo."
        ),
        variant: "destructive",
      });
    } else {
      toast({
        title: "Éxito",
        description: "Tu contraseña ha sido actualizada correctamente",
        variant: "default",
      });
      router.push('/login');
    }
    
    setIsLoading(false);
  };

  return (
    <div className="auth-screen bg-gradient-to-b from-background to-secondary">
      <form onSubmit={handleUpdatePassword} className="w-full max-w-md space-y-4">
        <h1 className="text-3xl font-bold text-center mb-6">Actualizar Contraseña</h1>
        <p className="text-center text-muted-foreground mb-4">
          Ingresa tu nueva contraseña
        </p>
        <Input
          type="password"
          placeholder="Nueva contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
        <Input
          type="password"
          placeholder="Confirmar contraseña"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={6}
        />
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? "Actualizando..." : "Actualizar contraseña"}
        </Button>
      </form>
    </div>
  );
} 