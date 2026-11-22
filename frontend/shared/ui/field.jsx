import { forwardRef, useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

const control = 'h-10 w-full rounded-[10px] border border-black/[0.11] bg-white px-3 text-[14px] text-neutral-900 shadow-hairline '
  + 'placeholder:text-neutral-400 transition-[border-color,box-shadow] duration-150 ease-out '
  + 'hover:border-black/[0.2] focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/12 '
  + 'disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-400 aria-invalid:border-severe aria-invalid:ring-severe/10';

export function Label({ className, children, required, ...props }) {
  return <label className={cn('mb-1.5 block text-[13px] font-medium text-neutral-700', className)} {...props}>
    {children}{required && <span className="ml-0.5 text-severe" aria-hidden>*</span>}
  </label>;
}

/** Pole tekstowe; `icon` po lewej (np. kalendarz), `end` po prawej (np. przycisk). */
export const Input = forwardRef(function Input({ className, icon, end, ...props }, ref) {
  if (!icon && !end) return <input ref={ref} className={cn(control, className)} {...props}/>;
  return <div className="relative">
    {icon && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-neutral-400 [&_svg]:size-4">{icon}</span>}
    <input ref={ref} className={cn(control, icon && 'pl-9', end && 'pr-11', className)} {...props}/>
    {end && <span className="absolute inset-y-0 right-1 flex items-center">{end}</span>}
  </div>;
});

/** Natywna lista wyboru (dobra na telefonie), wyglądem jak pole tekstowe. */
export const NativeSelect = forwardRef(function NativeSelect({ className, children, ...props }, ref) {
  return <div className="relative">
    <select ref={ref} className={cn(control, 'appearance-none pr-9', className)} {...props}>{children}</select>
    <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400"/>
  </div>;
});

/** Etykieta + kontrolka + podpowiedź/błąd z poprawnymi powiązaniami aria. `children(id, describedBy)`. */
export function Field({ label, hint, error, required, className, children }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return <div className={className}>
    {label && <Label htmlFor={id} required={required}>{label}</Label>}
    {children(id, describedBy)}
    {hint && !error && <p id={hintId} className="mt-1.5 text-[12px] text-neutral-500">{hint}</p>}
    {error && <p id={errorId} className="mt-1.5 text-[12px] font-medium text-severe-ink">{error}</p>}
  </div>;
}
