"use client"

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { Chatbot } from '@/types/chatbot';

export default function ChatbotList({
  teamId,
  refreshKey = 0,
}: {
  teamId: string;
  refreshKey?: number;
}) {
  const [chatbots, setChatbots] = useState<Chatbot[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClientComponentClient();

  useEffect(() => {
    const fetchChatbots = async () => {
      const { data, error } = await supabase
        .from('chatbots')
        .select('id, name, description, team_id')
        .eq('team_id', teamId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching chatbots:', error);
      } else {
        setChatbots((data ?? []) as Chatbot[]);
      }
      setLoading(false);
    };

    fetchChatbots();
  }, [teamId, supabase, refreshKey]);

  return (
    <div className="space-y-2">
      {chatbots.map((chatbot) => (
        <Button key={chatbot.id} variant="outline" asChild className="w-full justify-start h-auto py-2">
          <Link href={`/chatbot/${chatbot.id}`}>
            <div className="text-left">
              <div className="font-bold">{chatbot.name}</div>
              <div className="text-sm text-muted-foreground">{chatbot.description}</div>
            </div>
          </Link>
        </Button>
      ))}
      {!loading && chatbots.length === 0 && (
        <p>Todavía no hay asistentes. Crea uno para comenzar.</p>
      )}
    </div>
  );
}
