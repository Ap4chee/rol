import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/shared/lib/cn';

/**
 * Dymek. Pierwszy pojawia się po krótkiej zwłoce, kolejne (gdy jeden już był otwarty) od razu i bez animacji
 * (data-state="instant-open"), więc przesuwanie kursora po ikonach jest szybkie.
 */
export function TooltipProvider({ children }) {
  return <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={400}>{children}</TooltipPrimitive.Provider>;
}

export function Tooltip({ label, side = 'top', children, disabled }) {
  if (disabled || !label) return children;
  return <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content side={side} sideOffset={8} collisionPadding={8}
        className={cn('z-[80] max-w-64 origin-(--radix-tooltip-content-transform-origin) rounded-lg bg-neutral-900 px-2.5 py-1.5 text-[12px] font-medium leading-snug text-white shadow-overlay',
          'data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-[state=delayed-open]:duration-150 data-[state=delayed-open]:ease-out',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100')}>
        {label}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>;
}
