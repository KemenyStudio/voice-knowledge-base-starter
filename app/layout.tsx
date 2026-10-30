import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { AppViewport } from "@/components/app-viewport"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { Analytics } from "@vercel/analytics/react";
import { appName } from "@/app/config/assistant-defaults";

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: appName,
  description: 'Search a private document library and read answers with cited passages.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#141414',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
        <AppViewport />
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
          storageKey="document-search-theme"
        >
          {children}
          <Toaster />
          <SonnerToaster />
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  );
}