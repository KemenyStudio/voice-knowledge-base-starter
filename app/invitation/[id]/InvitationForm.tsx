"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { acceptInvitation } from "@/app/actions/team";
import { LegalLinks } from "@/components/LegalLinks";

interface InvitationFormProps {
  invitation: { id: string; email: string; teamName: string };
}

export default function InvitationForm({ invitation }: InvitationFormProps) {
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const result = await acceptInvitation({
        invitationId: invitation.id,
        password,
      });

      if (!result.ok) {
        toast({
          title: "Error",
          description: result.error,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "¡Listo!",
        description: "Registro exitoso. Por favor, revisa tu correo electrónico para verificar tu cuenta."
      });
      router.push('/login');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4">
      <h1 className="text-3xl font-bold text-center mb-6">
        {invitation.teamName ? `Únete a ${invitation.teamName}` : "¡Bienvenido!"}
      </h1>
      <p className="text-center">Para unirte al equipo, por favor completa el siguiente formulario:</p>
      <Input type="email" placeholder="Email" value={invitation.email} disabled />
      <Input
        type="password"
        placeholder="Contraseña (mínimo 8 caracteres)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        minLength={8}
        required
      />
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        Unirme al equipo
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Al unirte aceptas los términos y el aviso de privacidad.
      </p>
      <LegalLinks />
    </form>
  );
}
