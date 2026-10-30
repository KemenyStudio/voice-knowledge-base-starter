"use client"

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from "@/hooks/use-toast"
import {
  DEFAULT_SUGGESTED_QUESTIONS,
  defaultWelcomeMessage,
} from "@/app/config/assistant-defaults"

export default function CreateChatbotDialog({
  teamId,
  onCreated,
}: {
  teamId: string;
  onCreated?: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const supabase = createClientComponentClient();
  const { toast } = useToast();

  const handleCreateChatbot = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    // The knowledge base (OpenAI vector store) is created on the first upload.
    const { error } = await supabase
      .from('chatbots')
      .insert([{
        name: name.trim(),
        description: description.trim(),
        team_id: teamId,
        welcome_message: defaultWelcomeMessage(name),
        suggested_questions: DEFAULT_SUGGESTED_QUESTIONS,
      }]);
    setIsSubmitting(false);

    if (error) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Listo",
      description: "Asistente creado. Sube documentos para que pueda responder.",
    });
    setName('');
    setDescription('');
    setIsOpen(false);
    onCreated?.();
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="mt-4">Nuevo asistente</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crear un asistente</DialogTitle>
          <DialogDescription>
            Cada asistente tiene su propia biblioteca de documentos, visible solo para tu equipo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleCreateChatbot} className="space-y-4">
          <Input
            placeholder="Nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Textarea
            placeholder="Descripción (de qué trata su biblioteca)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
          <Button type="submit" disabled={isSubmitting}>Crear asistente</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
