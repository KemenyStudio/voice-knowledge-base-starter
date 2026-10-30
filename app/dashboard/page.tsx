"use client"

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useToast } from "@/hooks/use-toast"
import CreateTeamDialog from '@/components/CreateTeamDialog';
import TeamList from '@/components/TeamList';
import AssistantList from '@/components/AssistantList';
import { authErrorMessage } from '@/lib/auth/messages';

export default function Dashboard() {
  const [user, setUser] = useState<any>(null);
  const router = useRouter();
  const supabase = createClientComponentClient();
  const { toast } = useToast();

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

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast({
        title: "Error",
        description: authErrorMessage(error.message, "No se pudo cerrar la sesión."),
        variant: "destructive",
      });
    } else {
      router.push('/login');
    }
  };

  if (!user) return null;

  return (
    <div className="container mx-auto max-w-full px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">Inicio</h1>
        <Button onClick={handleLogout}>Cerrar sesión</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Tus equipos</CardTitle>
          </CardHeader>
          <CardContent>
            <TeamList userId={user.id} />
            <CreateTeamDialog userId={user.id} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Tus asistentes</CardTitle>
          </CardHeader>
          <CardContent>
            <AssistantList />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}