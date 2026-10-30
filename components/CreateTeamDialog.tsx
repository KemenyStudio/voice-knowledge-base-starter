"use client"

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from "@/hooks/use-toast";

export default function CreateTeamDialog({ userId }: { userId: string }) {
  const [teamName, setTeamName] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const supabase = createClientComponentClient();
  const { toast } = useToast();

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data, error } = await supabase
      .from('teams')
      .insert([{ name: teamName, created_by: userId }])
      .select();

    if (error) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Success",
        description: "Team created successfully",
      });
      setTeamName('');
      setIsOpen(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="mt-4">Create New Team</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a New Team</DialogTitle>
          <DialogDescription>
            Enter the name of your new team below.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleCreateTeam} className="space-y-4">
          <Input
            placeholder="Team Name"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            required
          />
          <Button type="submit">Create Team</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}