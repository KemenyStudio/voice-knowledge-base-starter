"use client"

import { useEffect } from "react"

/** Match the shell to the visible window, including mobile browser chrome. */
export function AppViewport() {
  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      const viewport = window.visualViewport
      const height = viewport?.height ?? window.innerHeight
      const offsetTop = viewport?.offsetTop ?? 0
      root.style.setProperty("--app-height", `${height}px`)
      root.style.setProperty("--app-offset-top", `${offsetTop}px`)
    }

    apply()
    const viewport = window.visualViewport
    viewport?.addEventListener("resize", apply)
    viewport?.addEventListener("scroll", apply)
    window.addEventListener("resize", apply)
    window.addEventListener("orientationchange", apply)
    return () => {
      viewport?.removeEventListener("resize", apply)
      viewport?.removeEventListener("scroll", apply)
      window.removeEventListener("resize", apply)
      window.removeEventListener("orientationchange", apply)
    }
  }, [])

  return null
}
