"use client";

import { useEffect, useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface Team {
  id: string;
  name: string;
}

export default function TeamList({ userId }: { userId: string }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const supabase = createClientComponentClient();

  useEffect(() => {
    const fetchTeams = async () => {
      const { data, error } = await supabase
        .from("team_members")
        .select(`
          team_id,
          teams (id, name)
        `)
        .eq("user_id", userId);

      if (error) {
        console.error("Error fetching teams:", error);
      } else {
        const formattedTeams = data.map((member: any) => member.teams);
        setTeams(formattedTeams || []);
      }
    };

    fetchTeams();
  }, [userId, supabase]);

  return (
    <div className="space-y-2">
      {teams.map((team) => (
        <Button
          key={team.id}
          variant="outline"
          asChild
          className="w-full justify-start"
        >
          <Link href={`/team/${team.id}`}>{team.name}</Link>
        </Button>
      ))}
      {teams.length === 0 && (
        <p>Aún no perteneces a ningún equipo. Crea uno o acepta una invitación para empezar.</p>
      )}
    </div>
  );
}
