import {
  ResponsiveModal, ResponsiveModalContent, ResponsiveModalDescription, ResponsiveModalHeader, ResponsiveModalTitle,
} from '@/components/spectrumui/responsive-modal';
import { cn } from '@/lib/utils';

/**
 * Okno dialogowe (Responsive Modal ze Spectrum UI): na komputerze okno na środku, na telefonie arkusz od dołu.
 * `width`: klasa maksymalnej szerokości na komputerze.
 */
export function Dialog({ open, onOpenChange, title, description, width = 'lg:max-w-lg', className, children }) {
  return <ResponsiveModal open={open} onOpenChange={onOpenChange}>
    <ResponsiveModalContent side="bottom" className={cn('pt-7 lg:pt-6', width, className)}
      onOpenAutoFocus={(event) => {
        // fokus na polu oznaczonym data-autofocus (jak wcześniej w Mantine), inaczej na pierwszym elemencie
        const target = event.currentTarget?.querySelector?.('[data-autofocus]');
        if (target) { event.preventDefault(); target.focus(); }
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
