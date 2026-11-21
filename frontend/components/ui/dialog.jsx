import { useLayoutEffect, useRef } from 'react';
import {
  ResponsiveModal, ResponsiveModalContent, ResponsiveModalDescription, ResponsiveModalHeader, ResponsiveModalTitle,
} from '@/components/spectrumui/responsive-modal';
import { cn } from '@/lib/utils';

/**
 * Okno dialogowe (Responsive Modal ze Spectrum UI): na komputerze okno na środku, na telefonie arkusz od dołu.
 * `width`: klasa maksymalnej szerokości na komputerze.
 */
export function Dialog({ open, onOpenChange, title, description, width = 'lg:max-w-lg', className, children }) {
  // przycisk, który otworzył okno: tam wraca fokus po Escape / Anuluj / X (okno otwierane jest stanem, nie przez Trigger)
  const opener = useRef(null);
  useLayoutEffect(() => { if (open) opener.current = document.activeElement; }, [open]);

  return <ResponsiveModal open={open} onOpenChange={onOpenChange}>
    <ResponsiveModalContent side="bottom" className={cn(width, className)}
      onOpenAutoFocus={(event) => {
        // fokus na polu oznaczonym data-autofocus (jak wcześniej w Mantine), inaczej na pierwszym elemencie
        const target = event.currentTarget?.querySelector?.('[data-autofocus]');
        if (target) { event.preventDefault(); target.focus(); }
      }}
      onCloseAutoFocus={(event) => {
        // po udanym wysłaniu fokus zostaje tam, gdzie przeniósł go raport (nagłówek); po anulowaniu wraca do przycisku
        const element = opener.current;
        const active = document.activeElement;
        if (element?.isConnected && (!active || active === document.body || event.currentTarget?.contains?.(active))) {
          event.preventDefault();
          element.focus();
        }
      }}>
      <ResponsiveModalHeader className="pr-10 text-left">
        <ResponsiveModalTitle>{title}</ResponsiveModalTitle>
        {description ? <ResponsiveModalDescription>{description}</ResponsiveModalDescription>
          : <ResponsiveModalDescription className="sr-only">{title}</ResponsiveModalDescription>}
      </ResponsiveModalHeader>
      {children}
    </ResponsiveModalContent>
  </ResponsiveModal>;
}
