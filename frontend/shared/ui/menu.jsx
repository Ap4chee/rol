import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Ellipsis } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { Button } from './button.jsx';

/**
 * Przycisk „…” z listą rzadziej używanych działań. `items`: [{ label, icon, onSelect, danger }].
 * Strzałki przenoszą fokus po pozycjach, Escape zamyka i wraca na przycisk.
 */
export function MoreMenu({ items, label = 'Więcej opcji', size = 'icon', className }) {
  const [open, setOpen] = useState(false);

  function onKeyDown(event) {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const entries = [...event.currentTarget.querySelectorAll('[role="menuitem"]')];
    const at = entries.indexOf(document.activeElement);
    entries[(at + step + entries.length) % entries.length]?.focus();
  }

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <Button variant="secondary" size={size} aria-label={label} aria-haspopup="menu" className={className}><Ellipsis/></Button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content role="menu" aria-label={label} align="end" sideOffset={6} collisionPadding={8} onKeyDown={onKeyDown}
        className={cn('no-print z-[60] min-w-44 origin-(--radix-popover-content-transform-origin) rounded-xl border border-black/[0.08] bg-white p-1 shadow-overlay outline-none',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-150 data-[state=open]:ease-out',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100')}>
        {items.map(({ label: text, icon: Icon, onSelect, danger }) => <button key={text} type="button" role="menuitem"
          onClick={() => { setOpen(false); onSelect(); }}
          className={cn('press flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[14px] font-medium',
            danger ? 'text-severe-ink hover:bg-severe-soft' : 'text-neutral-800 hover:bg-black/[0.045]')}>
          {Icon && <Icon aria-hidden className={cn('size-4 shrink-0', danger ? 'text-severe' : 'text-neutral-500')} strokeWidth={2}/>}
          {text}
        </button>)}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
