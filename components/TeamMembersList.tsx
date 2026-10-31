"use client"

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface TeamMember {
  id: string;
  email: string;
  role: string;
  lastInteraction: string;
  totalMessages: number;
}

export default function TeamMembersList({ teamId }: { teamId: string }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const supabase = createClientComponentClient();

  useEffect(() => {
    const fetchMembers = async () => {
      const { data, error } = await supabase
        .from('team_members')
        .select(`
          id,
          role,
          profiles:user_id (email, last_interaction, total_messages)
        `)
        .eq('team_id', teamId);

      if (error) {
        console.error('Error fetching team members:', error);
      } else {
        setMembers(data.map((member: any) => ({
          id: member.id,
          email: member.profiles.email,
          role: member.role,
          lastInteraction: member.profiles.last_interaction,
          totalMessages: member.profiles.total_messages,
        })));
      }
    };

    fetchMembers();
  }, [teamId, supabase]);

  return (
    <div className="space-y-4">
      {members.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuario</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Última interacción</TableHead>
              <TableHead>Mensajes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.id}>
                <TableCell className="flex items-center space-x-3">
                  <Avatar>
                    <AvatarImage src={`https://www.gravatar.com/avatar/${member.id}?d=mp`} />
                    <AvatarFallback>{member.email[0].toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span>{member.email}</span>
                </TableCell>
                <TableCell>{member.role}</TableCell>
                <TableCell>
                  {member.lastInteraction
                    ? new Date(member.lastInteraction).toLocaleString('es-ES', {
                      dateStyle: 'medium',
                      timeStyle: 'short'
                    })
                    : 'No disponible'}
                </TableCell>
                <TableCell className="text-center">{member.totalMessages}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p>No team members found.</p>
      )}
    </div>
  );
}