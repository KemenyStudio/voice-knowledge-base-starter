"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDefaultChatbot } from '@/app/actions/user';
import { appName } from '@/app/config/assistant-defaults';
import { BrandMark } from '@/components/brand-mark';


export default function Home() {
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const initUser = async () => {
      const defaultChatbot = await getDefaultChatbot();

      if (defaultChatbot) {
        router.push(`/chatbot/${defaultChatbot.id}`);
      }
      setLoading(false);
    };

    initUser();
  }, [router])

  return (
    <div className="auth-screen bg-gradient-to-b from-background to-secondary text-center">
      <BrandMark className="mb-6 h-16 w-16" />
      <h1 className="mb-6 text-3xl font-bold sm:text-4xl">{appName}</h1>
      <h3 className="mb-6 max-w-md text-base leading-6">Search a private document library and read answers with cited passages.</h3>
      {!loading && (
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href="/login">Iniciar sesión</Link>
          </Button>
          {/* <Button asChild variant="outline">
            <Link href="/register">Register</Link>
          </Button> */}
        </div>
      )}
    </div>
  );
}
