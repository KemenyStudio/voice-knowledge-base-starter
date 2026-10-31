"use client"

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import TeamMembersList from '@/components/TeamMembersList';
import InviteMemberDialog from '@/components/InviteMemberDialog';
import ChatbotList from '@/components/ChatbotList';
import CreateChatbotDialog from '@/components/CreateChatbotDialog';
import { checkTeamAdmin } from '@/app/actions/team';
import OnboardingChecklist from '@/components/OnboardingChecklist';
import { Team } from '@/types/team';

export default function TeamPageClient({
  team,
  onNavigate,
}: {
  team: Team | null;
  /** Switches the app view (for example to the library). */
  onNavigate?: (view: string) => void;
}) {
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const router = useRouter();
  const supabase = createClientComponentClient();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUser(user);
      } else {
        router.push('/login');
      }
    };
    getUser();
  }, [supabase, router]);

  useEffect(() => {
    if (team) checkTeamAdmin(team.id).then(setIsAdmin);
  }, [team]);

  if (!team || !user) return null;

  return (
    <motion.div
      className="h-full w-full min-w-0 space-y-4 overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg dark:bg-black sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {isAdmin && (
        <OnboardingChecklist
          teamId={team.id}
          refreshKey={refreshKey}
          onAction={(step) => {
            if (step === 'documents') onNavigate?.('biblioteca');
            else if (step === 'question') onNavigate?.('chat');
            else document.getElementById(step === 'assistant' ? 'team-assistants' : 'team-members')?.scrollIntoView({ behavior: 'smooth' });
          }}
        />
      )}
      <Card id="team-assistants" className="dark:bg-black shadow-lg">
        <CardHeader className="flex-none">
          <CardTitle>Asistentes de {team.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChatbotList teamId={team.id} refreshKey={refreshKey} />
          {isAdmin && (
            <CreateChatbotDialog
              teamId={team.id}
              onCreated={() => setRefreshKey((key) => key + 1)}
            />
          )}
        </CardContent>
      </Card>
      <Card id="team-members" className="dark:bg-black shadow-lg">
        <CardHeader className="flex-none">
          <CardTitle>Miembros del Equipo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex justify-end">
              <InviteMemberDialog teamId={team.id} />
            </div>
            <TeamMembersList teamId={team.id} />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
