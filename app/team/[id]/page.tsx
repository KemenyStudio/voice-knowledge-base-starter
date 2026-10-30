import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { Team } from '@/types/team';

import TeamPageClient from '@/components/TeamPageClient';
import { uuidSchema } from '@/lib/auth/access';

export const dynamic = 'force-dynamic';

export default async function TeamPage({ params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) notFound();

  const supabase = createServerComponentClient({ cookies });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Explicit membership check: does not rely on RLS being enabled.
  const { data: membership } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', params.id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) notFound();

  const { data, error } = await supabase
    .from('teams')
    .select('id, name')
    .eq('id', params.id)
    .maybeSingle();

  if (error) {
    console.error('Error fetching team:', error);
    return <div>Error loading team</div>;
  }
  if (!data) notFound();

  return <TeamPageClient team={data as Team} />;
}
