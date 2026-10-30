"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { joinWithInvitation } from "@/app/actions/team";

interface JoinInvitationProps {
  invitation: { id: string; email: string; teamName: string };
  signedInEmail: string;
}

/** Invitation page for someone who is already signed in. */
export default function JoinInvitation({ invitation, signedInEmail }: JoinInvitationProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const matches = invitation.email.toLowerCase() === signedInEmail.toLowerCase();

  const join = async () => {
    setIsSubmitting(true);
    try {
      const result = await joinWithInvitation(invitation.id);
      if (!result.ok) {
        toast({ title: "Error", description: result.error, variant: "destructive" });
        return;
      }
      toast({ title: "¡Listo!", description: "Ya eres parte del equipo." });
      router.push(`/team/${result.teamId}`);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md space-y-4 text-center">
      <h1 className="text-3xl font-bold">
        {invitation.teamName ? `Únete a ${invitation.teamName}` : "¡Bienvenido!"}
      </h1>
      {matches ? (
        <>
          <p>Iniciaste sesión como {signedInEmail}.</p>
          <Button onClick={join} className="w-full" disabled={isSubmitting}>
            Unirme al equipo
          </Button>
        </>
      ) : (
        <p>
          Esta invitación es para {invitation.email}, pero iniciaste sesión como{" "}
          {signedInEmail}. Cierra sesión e inicia con la cuenta invitada.
        </p>
      )}
    </div>
  );
}
