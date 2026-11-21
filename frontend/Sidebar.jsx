import { useState } from 'react';
import { LayoutDashboard, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// Geometria (pasek 248 px / zwinięty 68 px, odstęp boczny 12 px): ikony, znak marki i przycisk zwijania mają środek
// w tym samym miejscu w obu stanach, więc przy zwijaniu nic nie skacze, chowają się tylko podpisy.
// Podpisy po rozwinięciu wchodzą krótko z przezroczystości; po zwinięciu znikają od razu i zostają dla czytników
// ekranu (sr-only), a nazwę pokazuje dymek po prawej.
const REVEAL = 'animate-in fade-in-0 slide-in-from-left-1 duration-200 ease-out motion-reduce:animate-none';

/** Czy wartość zmieniła się od pierwszego wyświetlenia (wtedy podpisy wchodzą z animacją, a przy ładowaniu strony nie). */
function useChangedSinceMount(value) {
  const [initial] = useState(value);
  const [changed, setChanged] = useState(false);
  if (!changed && value !== initial) setChanged(true);
  return changed;
}

/** Znak marki: kropla nad falą (ten sam rysunek co ikona karty przeglądarki) na zielonym kafelku. */
function BrandMark() {
  return <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-brand-700 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.16),0_1px_2px_rgb(13_35_23/0.28)]">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" className="size-[17px]">
      <path d="M12 2c-3 4-5 6-5 9a5 5 0 0 0 10 0c0-3-2-5-5-9Z"/>
      <path d="M3 19q4.5-3 9 0t9 0"/>
    </svg>
  </span>;
}

/**
 * Marka: link do pulpitu. `compact`: sam znak (nazwa zostaje dla czytników ekranu).
 * `reveal`: nazwa wchodzi z animacją (po rozwinięciu menu przez użytkownika).
 */
export function Brand({ compact = false, reveal = false, onClick, className }) {
  // przycinanie zamiast wielokropka: przy rozwijaniu menu nazwa odsłania się czysto, bez „Asystent wo…”
  return <a href="#" onClick={onClick} className={cn('press flex h-10 min-w-0 items-center gap-2 overflow-hidden rounded-[10px] px-2', className)}>
    <BrandMark/>
    <span className={compact ? 'sr-only'
      : cn('whitespace-nowrap font-display text-[16px] font-semibold tracking-[-0.015em] text-neutral-950', reveal && REVEAL)}>
      Asystent wody
    </span>
  </a>;
}

/** Pozycja menu: link (`href`) albo przycisk. Aktywna to biała pigułka na tle strony. */
function NavItem({ icon: Icon, label, active = false, compact, reveal, href, onClick }) {
  const Comp = href ? 'a' : 'button';
  return <Tooltip label={compact ? label : null} side="right">
    <Comp href={href} type={href ? undefined : 'button'} onClick={onClick} aria-current={active ? 'page' : undefined}
      className={cn('press group flex h-10 w-full items-center gap-3.5 overflow-hidden whitespace-nowrap rounded-[10px] pl-3.5 pr-3 text-left text-[14px] font-medium md:h-9',
        active
          ? 'bg-white text-neutral-950 shadow-[0_0_0_1px_rgb(14_16_13/0.06),0_1px_2px_rgb(14_16_13/0.05)]'
          : 'text-neutral-600 hover:bg-black/[0.045] hover:text-neutral-950')}>
      <Icon aria-hidden strokeWidth={2} className={cn('size-4 shrink-0 transition-[color] duration-150 ease-out',
        active ? 'text-brand-700' : 'text-neutral-500 group-hover:text-neutral-800')}/>
      <span className={compact ? 'sr-only' : reveal ? REVEAL : undefined}>{label}</span>
    </Comp>
  </Tooltip>;
}

/** Nawigacja: pulpit i dodawanie pola (modal). `compact`: same ikony z dymkami (tylko na komputerze). */
export function Sidebar({ page, compact, onToggle, onNavigate, onAdd }) {
  const toggleLabel = compact ? 'Rozwiń menu' : 'Zwiń menu';
  const reveal = useChangedSinceMount(compact);
  return <div className="flex h-full flex-col px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:pb-2 md:pt-2">
    <Brand compact={compact} reveal={reveal} onClick={onNavigate}/>
    <nav aria-label="Menu główne" className="mt-6">
      <ul className="flex flex-col gap-0.5">
        <li><NavItem href="#" icon={LayoutDashboard} label="Pulpit" active={page === 'dashboard'} compact={compact} reveal={reveal} onClick={onNavigate}/></li>
        <li><NavItem icon={Plus} label="Dodaj pole" compact={compact} reveal={reveal} onClick={() => { onNavigate(); onAdd(); }}/></li>
      </ul>
    </nav>
    <div className="mt-auto flex flex-col gap-3 pt-8">
      {!compact && <p className={cn('eyebrow whitespace-nowrap pl-3.5', reveal && REVEAL)}>Bilans wody · dane otwarte</p>}
      {/* zwijanie tylko na komputerze; przycisk stoi w tym samym miejscu w obu stanach, więc można od razu cofnąć */}
      <div className="hidden pl-1.5 md:block">
        <Tooltip label={toggleLabel} side="right">
          <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label={toggleLabel}>
            {compact ? <PanelLeftOpen strokeWidth={1.9}/> : <PanelLeftClose strokeWidth={1.9}/>}
          </Button>
        </Tooltip>
      </div>
    </div>
  </div>;
}
