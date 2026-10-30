import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import ChatbotPageClient from '@/components/ChatbotPageClient';
import { uuidSchema } from '@/lib/auth/access';
import type { Chatbot } from '@/types/chatbot';

export const dynamic = 'force-dynamic';

export default async function ChatbotPage({ params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) notFound();

  const supabase = createServerComponentClient({ cookies });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: chatbot, error } = await supabase
    .from('chatbots')
    .select('id, name, description, team_id, welcome_message, suggested_questions, audience_options, audience_filter, prompt_notes, research_enabled, enabled_tools')
    .eq('id', params.id)
    .maybeSingle();

  if (error) {
    console.error('Error fetching chatbot:', error);
    return <div>Error loading chatbot</div>;
  }
  if (!chatbot) notFound();

  // Explicit membership check: does not rely on RLS being enabled.
  const { data: membership } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', chatbot.team_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) notFound();

  return <ChatbotPageClient chatbot={chatbot as Chatbot} />;
}
