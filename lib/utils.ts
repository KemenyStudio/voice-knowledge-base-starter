import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"


export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function parseCustomMath(text: string): string {
  return text
    .replace(/\\\[/g, '$$')   // Convert \[ to $$
    .replace(/\\\]/g, '$$')   // Convert \] to $$
    .replace(/\\\(/g, '$')    // Convert \( to $
    .replace(/\\\)/g, '$')    // Convert \) to $
}