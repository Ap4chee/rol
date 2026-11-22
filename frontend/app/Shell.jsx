import { useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { ResponsiveModal, ResponsiveModalContent, ResponsiveModalTitle, ResponsiveModalTrigger } from '@/shared/ui/effects';
import { Tooltip } from '@/shared/ui/tooltip';
import { Brand, Sidebar } from './Sidebar.jsx';

const COMPACT_KEY = 'kowr.sidebar-compact';

/** Zwinięte menu na komputerze, zapamiętane w przeglądarce. Na telefonie menu jest szufladą, zawsze pełną. */
function useCompactSidebar(desktop) {
  const [preference, setPreference] = useState(() => { try { return localStorage.getItem(COMPACT_KEY) === '1'; } catch { return false; } });
  function toggle() {
    const next = !preference;
    setPreference(next);
    try { localStorage.setItem(COMPACT_KEY, next ? '1' : '0'); } catch { /* tylko wygoda, bez zapisu też działa */ }
  }
  return [preference && desktop, toggle];
}

/**
 * Układ: na komputerze menu na tle strony (bez ramki), treść na białym panelu z marginesem; na telefonie
 * górny pasek (stała wysokość, udostępniona jako --app-header dla przyklejanych pasków niżej) i treść na całą szerokość.
 * Szerokość menu zmienia się tylko po kliknięciu (rzadko), więc krótkie przejście kolumny siatki jest w porządku.
 */
export function Shell({ page, desktop, menuOpen, onMenuOpen, onAdd, onHelp, children, overlays }) {
  const [compact, toggleCompact] = useCompactSidebar(desktop);
  const closeMenu = () => onMenuOpen(false);
  // szuflada istnieje tylko na telefonie: po poszerzeniu okna zamykamy ją
  useEffect(() => { if (desktop) onMenuOpen(false); }, [desktop, onMenuOpen]);

  return <div style={{ '--sidebar': compact ? '68px' : '248px' }}
    className="min-h-svh [--app-header:3.5rem] md:grid md:grid-cols-[var(--sidebar)_minmax(0,1fr)] md:[--app-header:0px] print:block!">
    {/* bez zmiany adresu: hash służy do przełączania widoków */}
    <a href="#main-content" onClick={(event) => {
      event.preventDefault();
      document.getElementById('main-content').focus();
    }} className="no-print fixed left-3 top-3 z-[100] -translate-y-[200%] rounded-[10px] bg-white px-3.5 py-2 text-[13.5px] font-medium text-neutral-900 shadow-raised ring-1 ring-black/[0.08] focus:translate-y-0">
      Przejdź do treści
    </a>

    <ResponsiveModal open={menuOpen} onOpenChange={onMenuOpen}>
      <header className="no-print sticky top-0 z-40 flex h-14 items-center gap-0.5 border-b border-black/[0.06] bg-canvas/90 px-2 backdrop-blur-md md:hidden">
        <Tooltip label="Menu">
          <ResponsiveModalTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Otwórz menu" data-tour="menu"><Menu strokeWidth={1.9}/></Button>
          </ResponsiveModalTrigger>
        </Tooltip>
        <Brand/>
      </header>
      {/* szuflada z lewej (od strony przycisku), w tle strony, z tym samym menu co na komputerze */}
      <ResponsiveModalContent side="left" aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          // fokus na bieżącej pozycji menu: Radix pomija linki i trafiałby od razu w „Dodaj pole”
          const target = event.currentTarget?.querySelector?.('nav [aria-current="page"], nav a, nav button');
          if (target) { event.preventDefault(); target.focus(); }
        }}
        className="no-print w-[84vw] max-w-[300px] border-r-0 bg-canvas p-0 sm:max-w-[300px] [&>button]:top-[14px] [&>span]:hidden">
        <ResponsiveModalTitle className="sr-only">Menu</ResponsiveModalTitle>
        <Sidebar page={page} compact={false} onToggle={toggleCompact} onNavigate={closeMenu} onAdd={onAdd} onHelp={onHelp}/>
      </ResponsiveModalContent>
    </ResponsiveModal>

    <div className="no-print hidden overflow-hidden md:sticky md:top-0 md:block md:h-svh md:self-start">
      <Sidebar page={page} compact={compact} onToggle={toggleCompact} onNavigate={closeMenu} onAdd={onAdd} onHelp={onHelp}/>
    </div>

    <div className="print-plain flex min-h-[calc(100svh_-_var(--app-header))] min-w-0 flex-col overflow-x-clip bg-white md:my-2 md:mr-2 md:min-h-[calc(100svh_-_1rem)] md:rounded-2xl md:border md:border-black/[0.06] md:shadow-hairline print:min-h-0!">
      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
        <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 py-6 md:px-8 md:py-10 lg:px-10 print:max-w-none! print:p-0!">
          {children}
        </div>
      </main>
    </div>

    {overlays}
  </div>;
}
