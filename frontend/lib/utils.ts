import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Łączy klasy Tailwind; późniejsza klasa wygrywa z wcześniejszą (np. `p-4` z `p-2`). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
