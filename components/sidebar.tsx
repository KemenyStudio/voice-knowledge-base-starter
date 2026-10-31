import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  MessageSquare,
  Library,
  History,
  Settings2,
  X,
  Users,
  MessageSquareHeart,
  BarChart3,
  Network,
  PanelLeftClose,
} from 'lucide-react';
import { Chatbot } from '@/types/chatbot';
import { Button } from '@/components/ui/button';
import SidebarButton from './sidebar-button';
import { BrandMark } from "@/components/brand-mark";
import { PresenceCard } from "@/components/chat/PresenceCard";
import { SettingsCard } from "@/components/SettingsCard";
import type { VoiceLength, VoiceNavigation } from "@/lib/voice/call-settings";

interface SidebarProps {
  currentView: string;
  setCurrentView: (view: string) => void;
  chatbot: Chatbot | null;
  router: ReturnType<typeof useRouter>;
  isMobile?: boolean;
  onClose?: () => void;
  /** Desktop only. Hides the left navigation until the person shows it again. */
  onHide?: () => void;
  handleLogout: () => void;
  isAdmin: boolean | null;
  emailAlerts?: boolean;
  onEmailAlertsChange?: (value: boolean) => void;
  voiceLength?: VoiceLength;
  onVoiceLengthChange?: (value: VoiceLength) => void;
  voiceNavigation?: VoiceNavigation;
  onVoiceNavigationChange?: (value: VoiceNavigation) => void;
}

export default function Sidebar({
  currentView,
  setCurrentView,
  chatbot,
  isMobile,
  onClose,
  onHide,
  handleLogout,
  isAdmin,
  emailAlerts,
  onEmailAlertsChange,
  voiceLength,
  onVoiceLengthChange,
  voiceNavigation,
  onVoiceNavigationChange,
}: SidebarProps) {

  return (
    <motion.div
      className={`relative flex h-full w-full flex-col bg-white px-3 text-zinc-800 dark:bg-[#181818] dark:text-zinc-200 ${
        isMobile ? "pt-[max(0.75rem,env(safe-area-inset-top))]" : "py-4"
      } pb-[max(0.5rem,env(safe-area-inset-bottom))]`}
      initial={{ x: -300 }}
      animate={{ x: 0 }}
      exit={{ x: -300 }}
      transition={{ duration: 0.3 }}
    >
        <div className="min-h-0 flex-1 overflow-y-auto px-1">
        <div className="mb-4 flex items-center gap-2.5">
          <div
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5"
            onClick={() => {
              setCurrentView("chat");
              if (isMobile && onClose) {
                onClose();
              }
            }}
          >
            <BrandMark className="h-7 w-7 shrink-0 rounded-md" />
            <h2 className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {chatbot?.name ?? 'Asistente'}
            </h2>
          </div>
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={onClose}
              aria-label="Cerrar menú"
            >
              <X className="h-5 w-5" />
            </Button>
          )}
        </div>
        {onHide && (
          <button
            type="button"
            data-testid="hide-sidebar"
            aria-label="Ocultar menú"
            onClick={onHide}
            className="mb-3 flex h-8 w-full items-center justify-center gap-2 rounded-md border border-zinc-200 text-xs font-medium text-zinc-600 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5 dark:focus-visible:ring-zinc-500"
          >
            <PanelLeftClose className="h-4 w-4" aria-hidden />
            Ocultar menú
          </button>
        )}
        {typeof isAdmin === 'boolean' && (
          <nav className="flex flex-col space-y-0.5">
            <SidebarButton
              icon={MessageSquare}
              label="Chat"
              view="chat"
              currentView={currentView}
              setCurrentView={setCurrentView}
            />
            <SidebarButton
              icon={Library}
              label="Biblioteca"
              view="biblioteca"
              currentView={currentView}
              setCurrentView={setCurrentView}
            />
            {isAdmin &&
              <>
              <SidebarButton
                icon={MessageSquareHeart}
                label="Retroalimentación"
                view="feedback"
                currentView={currentView}
                setCurrentView={setCurrentView}
              />
              <SidebarButton
                icon={BarChart3}
                label="Uso"
                view="usage"
                currentView={currentView}
                setCurrentView={setCurrentView}
              />
              <SidebarButton
                icon={Network}
                label="Infraestructura"
                view="infra"
                currentView={currentView}
                setCurrentView={setCurrentView}
              />
              <SidebarButton
                icon={Users}
                label="Miembros"
                view="TeamPageClient"
                currentView={currentView}
                setCurrentView={setCurrentView}
              />
            </>
            }
            <SidebarButton
              icon={History}
              label="Historial"
              view="history"
              currentView={currentView}
              setCurrentView={setCurrentView}
            />
            {isAdmin && (
              <SidebarButton
                icon={Settings2}
                label="Asistente"
                view="assistant"
                currentView={currentView}
                setCurrentView={setCurrentView}
              />
            )}
          </nav>
        )}

        {chatbot && (
          <div className="mt-4 min-w-0">
            <PresenceCard name={chatbot.name ?? "Asistente"} />
          </div>
        )}
      </div>

      <div className="max-h-[min(22rem,52vh)] shrink-0 overflow-y-auto px-1 pt-2">
        <SettingsCard
          emailAlerts={emailAlerts}
          onEmailAlertsChange={chatbot ? onEmailAlertsChange : undefined}
          voiceLength={voiceLength}
          onVoiceLengthChange={chatbot ? onVoiceLengthChange : undefined}
          voiceNavigation={voiceNavigation}
          onVoiceNavigationChange={chatbot ? onVoiceNavigationChange : undefined}
          onLogout={handleLogout}
        />
      </div>
    </motion.div>
  );
}