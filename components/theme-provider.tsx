"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"
import { type ThemeProviderProps } from "next-themes/dist/types"

function SyncThemeAttribute() {
  const { resolvedTheme } = useTheme()

  React.useEffect(() => {
    const root = document.documentElement
    if (resolvedTheme === "light" || resolvedTheme === "dark") {
      root.setAttribute("data-theme", resolvedTheme)
    } else {
      root.removeAttribute("data-theme")
    }
    const color = resolvedTheme === "light" ? "#f4f6f8" : "#141414"
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (meta) meta.content = color
  }, [resolvedTheme])

  return null
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props}>
      <SyncThemeAttribute />
      {children}
    </NextThemesProvider>
  )
}