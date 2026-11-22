import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Pencil, Printer, Save, Trash2 } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { TextStates } from '@/shared/ui/effects';
import { MoreMenu } from '@/shared/ui/menu';
import { ParcelOutline } from '@/shared/ui/parcel-outline';
import { useToast } from '@/shared/ui/toaster';
import { cn } from '@/shared/lib/cn';
import { printWhenReady } from '@/shared/lib/printing';
import { CropTile, TILE } from '@/features/fields/CropTile';
import { Status } from '@/features/fields/Status';
import { headerFacts } from './logic.js';

const SAVE_LABELS = ['Zapisz pole', 'Zapisz', 'Zapisano'];
const SAVED_FEEDBACK_MS = 1800;

/** Ikona zapisu zamienia się w „ptaszek” na chwilę po zapisaniu (krótko, z rozmyciem zamiast skoku). */
function SaveIcon({ done }) {
  const swap = 'absolute inset-0 transition-[opacity,scale,filter] duration-200 ease-out motion-reduce:transition-opacity';
  return <span aria-hidden className="relative size-4 shrink-0">
    <Save className={cn(swap, done && 'scale-75 opacity-0 blur-[2px]')}/>
    <Check className={cn(swap, !done && 'scale-75 opacity-0 blur-[2px]')} strokeWidth={2.5}/>
  </span>;
}

/** Zapis raportu z linku jako pola; „Zapisano” wraca do „Zapisz” po chwili. */
function SaveButton({ field, saved, onSave }) {
  const { toast } = useToast();
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), SAVED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [justSaved]);

  function save() {
    if (!onSave(field)) return;
    setJustSaved(true);
    toast({ title: 'Zapisano pole. Raport będzie odświeżany codziennie.', status: 'success' });
  }

  const label = justSaved ? 'Zapisano' : saved ? 'Zapisz' : 'Zapisz pole';
  return <Button onClick={save} className="max-sm:flex-1">
    {/* miejsce na najdłuższy napis: przycisk nie zmienia szerokości przy „Zapisano”, ikona zostaje przy tekście */}
    <span className="grid justify-items-center">
      {SAVE_LABELS.map((text) => <span key={text} aria-hidden className="invisible col-start-1 row-start-1 flex items-center gap-2">
        <span className="size-4"/>{text}</span>)}
      <span className="col-start-1 row-start-1 flex items-center gap-2"><SaveIcon done={justSaved}/><TextStates text={label}/></span>
    </span>
  </Button>;
}

/** Nagłówek raportu: uprawa i sylwetka działki, fakty, nazwa ze stanem wody, zapis, PDF i menu pola. */
/** „Pobierz PDF”: układ wydruku potrzebuje chwili na mapę, prognozę i obrazki, więc przycisk pokazuje, że trwa składanie. */
function PdfButton() {
  const [preparing, setPreparing] = useState(false);
  const print = async () => {
    setPreparing(true);
    try { await printWhenReady(); } finally { setPreparing(false); }
  };
  return <Button variant="secondary" icon={<Printer/>} disabled={preparing} onClick={print}>
    {preparing ? 'Składam PDF…' : 'Pobierz PDF'}</Button>;
}

export function ReportHeader({ field, report, saved, onSave, onEdit, onDelete, onBack }) {
  const title = useRef(null);
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, []);
  const facts = headerFacts(report);

  return <>
    <Button variant="ghost" size="sm" icon={<ArrowLeft/>} onClick={onBack} className="no-print -ml-2 mb-4">Wstecz</Button>
    <header className="mb-7 flex animate-rise flex-col gap-5 motion-reduce:animate-none md:mb-8 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 items-center gap-4">
      {/* pole rolnika na pierwszy rzut oka: uprawa i kształt działki z geometrii */}
      <div className="flex shrink-0 gap-1.5">
        <CropTile crop={report.crop} className="size-12 md:size-14"/>
        <ParcelOutline geometry={report.parcel?.geometry} className={cn(TILE, 'size-12 p-1 md:size-14')}/>
      </div>
      <div className="min-w-0">
        {/* kropka sklejona twardą spacją z poprzednim faktem: zawinięty wiersz nigdy nie zaczyna się od „·” */}
        <p className="text-[13px] leading-relaxed text-neutral-500">
          {facts.map((fact, i) => <Fragment key={i}>
            {i > 0 && <span aria-hidden className="text-neutral-300">{' · '}</span>}
            <span className={cn(!fact.wrap && 'whitespace-nowrap', fact.warn && 'font-medium text-watch-ink')}>{fact.text}</span>
          </Fragment>)}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-2">
          {/* fokus tylko przenosi czytnik ekranu na tytuł po otwarciu raportu (tabIndex -1, poza kolejnością Tab), więc bez ramki */}
          <h1 ref={title} tabIndex={-1} className="font-display text-[28px] font-semibold leading-[1.05] tracking-tight outline-none md:text-[34px]">
            {field.name}</h1>
          <Status water={report.water_status}/>
        </div>
      </div>
      </div>
      <div data-tour="report-actions" className="no-print flex shrink-0 items-center gap-2">
        {/* zapis tylko dla raportu z linku, którego nie ma jeszcze wśród pól; zapisane pole odświeża się samo */}
        {!saved && <SaveButton field={field} saved={saved} onSave={onSave}/>}
        <PdfButton/>
        <MoreMenu items={[{ label: 'Edytuj pole', icon: Pencil, onSelect: onEdit },
          ...(saved ? [{ label: 'Usuń pole', icon: Trash2, onSelect: onDelete, danger: true }] : [])]}/>
      </div>
    </header>
  </>;
}
