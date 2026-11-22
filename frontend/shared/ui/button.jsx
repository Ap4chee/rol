import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '@/shared/lib/cn';
import { Spinner } from './spinner.jsx';

// Na bazie LoadingButton ze Spectrum UI (cva + Slot + stan ładowania), w kolorach WaterOS.
export const buttonVariants = cva(
  'relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium '
  + 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 '
  + 'disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 '
  + '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'press bg-brand-700 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(13_35_23/0.3)] hover:bg-brand-800',
        secondary: 'press border border-black/[0.09] bg-white text-neutral-800 shadow-hairline hover:border-black/[0.16] hover:bg-neutral-50',
        ghost: 'press text-neutral-600 hover:bg-black/[0.045] hover:text-neutral-950',
        soft: 'press bg-brand-50 text-brand-800 hover:bg-brand-100',
        link: 'rounded-sm text-brand-700 underline-offset-4 transition-colors hover:text-brand-800 hover:underline',
        danger: 'press bg-severe text-white hover:bg-severe-ink',
      },
      size: {
        lg: 'h-12 rounded-xl px-5 text-[15px] [&_svg]:size-[18px]',
        md: 'h-10 rounded-[10px] px-4 text-[14px] [&_svg]:size-4',
        sm: 'h-8 rounded-lg px-3 text-[13px] [&_svg]:size-[15px]',
        xs: 'h-7 rounded-md px-2.5 text-[12px] [&_svg]:size-3.5',
        icon: 'size-10 rounded-[10px] [&_svg]:size-[18px]',
        'icon-sm': 'size-8 rounded-lg [&_svg]:size-4',
        inline: 'h-auto p-0 text-[inherit]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

/**
 * Przycisk. `loading`: spinner w miejscu lewej ikony i blokada kliknięć (szerokość się nie zmienia).
 * `asChild`: styl przycisku na własnym elemencie, np. `<Button asChild><a href="#">…</a></Button>`.
 */
export const Button = forwardRef(function Button(
  { className, variant, size, asChild = false, loading = false, icon, iconRight, disabled, children, type, ...props }, ref,
) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) return <Slot ref={ref} className={classes} {...props}>{children}</Slot>;
  return <button ref={ref} type={type ?? 'button'} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
    {loading ? <Spinner className="size-4"/> : icon}
    {children}
    {iconRight}
  </button>;
});
