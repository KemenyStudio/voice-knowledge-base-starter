import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";

import { getInvitation } from "@/app/actions/team";
import InvitationForm from "./InvitationForm";
import JoinInvitation from "./JoinInvitation";

interface InvitationPageProps {
  params: {
    id: string;
  };
}

export default async function InvitationPage({
  params: { id },
}: InvitationPageProps) {
  const supabase = createServerComponentClient({ cookies });
  const { data: { session } } = await supabase.auth.getSession();

  const invitation = await getInvitation(id);

  if (!invitation) {
    return (
      <div className="auth-screen text-center">
        <h1 className="text-2xl font-bold mb-4">Invitación no válida</h1>
        <p>Esta invitación no existe o ha expirado.</p>
      </div>
    );
  }

  return (
    <div className="auth-screen bg-gradient-to-b from-background to-secondary">
      {session ? (
        <JoinInvitation
          invitation={invitation}
          signedInEmail={session.user.email ?? ""}
        />
      ) : (
        <InvitationForm invitation={invitation} />
      )}
    </div>
  );
}
