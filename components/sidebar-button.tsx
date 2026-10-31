import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

interface SidebarButtonProps {
  icon: React.ComponentType<{ className?: string; }>;
  label: string;
  view?: string;
  url?: string;
  currentView: string;
  setCurrentView: (view: string) => void;
}

export default function SidebarButton({
  icon: Icon,
  label,
  view,
  url, 
  currentView,
  setCurrentView
}: SidebarButtonProps) {
  const router = useRouter();

  const handleClick = () => {
    if (url) {
      router.push(url);
    } else if (view) {
      setCurrentView(view);
    }
  };

  return (
    <Button
      variant={currentView === view ? "default" : "ghost"}
      className={`h-11 w-full justify-start rounded-md px-2 text-sm font-normal text-zinc-700 dark:text-zinc-300 md:h-8
                  ${currentView === view
          ? 'bg-zinc-200 text-zinc-900 hover:bg-zinc-200 dark:bg-white/10 dark:text-zinc-50 dark:hover:bg-white/10'
          : 'hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/5 dark:hover:text-zinc-100'}`}
      onClick={handleClick}
    >
      <Icon
        className={`mr-2 h-4 w-4 
          ${currentView === view
            ? 'text-zinc-900 dark:text-zinc-100'
            : 'text-zinc-500'
          }`}
      />
      <span className={`${currentView === view ? 'font-bold' : 'font-normal'}`}>
        {label}
      </span>
    </Button>
  );
}