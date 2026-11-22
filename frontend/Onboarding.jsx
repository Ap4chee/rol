import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { animate, AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Check, Droplet, Layers, MapIcon, MapPin, Menu, Plus, Printer, Search, X } from 'lucide-react';
import { EASE_OUT } from '@/shared/lib/ease';
import { Button } from '@/shared/ui/button';
import { StatusBadge } from '@/shared/ui/status';
import { cn } from '@/shared/lib/cn';
import { markSeen, nextTour, placeCard, readSeen, scrollDelta, seenAfter, spotlightRect, unionRect } from './onboarding.js';

// Samouczek w dwóch częściach: powitanie na pulpicie (co robi aplikacja i od czego zacząć) oraz objaśnienie
// pierwszego otwartego raportu. Krok z `art` to karta z ilustracją, krok z `target` podświetla prawdziwy element
// strony (znacznik data-tour). Ruch tylko tu, gdzie coś tłumaczy: samouczek widać raz, więc może być bogatszy.

// ---------- ilustracje kroków (ruch w app.css, sekcja „samouczek”) ----------

function Art({ className, children }) {
  return <div aria-hidden className={cn('tour-art relative grid h-[188px] place-items-center overflow-hidden md:h-[204px]', className)}>
    {children}
  </div>;
}

const after = (ms) => ({ animationDelay: `${ms}ms` });

/** Liczba doliczająca się od zera (przy ograniczonym ruchu od razu wartość końcowa). */
function CountUp({ to, delay = 0.3, duration = 0.9 }) {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? to : 0);
  useEffect(() => {
    if (reduced) { setValue(to); return undefined; }
    const controls = animate(0, to, { delay, duration, ease: EASE_OUT, onUpdate: (current) => setValue(Math.round(current)) });
    return () => controls.stop();
  }, [to, delay, duration, reduced]);
  return value;
}

// krople pod chmurą z ilustracji pola: [lewo %, góra %, opóźnienie ms]
const RAIN = [[69, 20, 0], [74, 25, 450], [79, 19, 800], [83, 26, 250], [88, 20, 600]];

/** Powitanie: makieta pola z przekrojem gleby, lekko unosi się, a z chmury pada. */
function HeroArt() {
  return <Art className="bg-[radial-gradient(80%_70%_at_50%_100%,var(--color-brand-100),transparent_75%),linear-gradient(180deg,#f7f3e9,#eef5ef)]">
    {[320, 220].map((width) => <span key={width} className="absolute left-1/2 top-[66%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-brand-700/[0.09]"
      style={{ width, height: width * 0.4 }}/>)}
    <div className="tour-pop relative w-[56%] max-w-[240px]">
      <div className="tour-float relative">
        <img src="/design/pole.webp" alt="" width="800" height="496" decoding="async" className="h-auto w-full drop-shadow-[0_12px_14px_rgba(0,0,0,0.16)]"/>
        {RAIN.map(([left, top, delay]) => <svg key={left} viewBox="0 0 6 9" className="tour-rain absolute h-[7px] w-[5px]"
          style={{ left: `${left}%`, top: `${top}%`, ...after(delay) }}>
          <path d="M3 0C3 0 0 3.6 0 5.8a3 3 0 0 0 6 0C6 3.6 3 0 3 0Z" fill="var(--color-water-400)"/>
        </svg>)}
      </div>
    </div>
  </Art>;
}

const PARCEL = 'M24 68 L150 58 L214 86 L190 182 L32 188 Z';
const CROPS = ['kukurydza', 'pszenica', 'rzepak'];

/** Krok 1: adres w wyszukiwarce, znacznik spada na pole, granica działki się obrysowuje, na końcu wybór uprawy. */
function FindArt() {
  return <Art>
    <div className="tour-zoom absolute inset-0">
      <img src="/design/pierwsze-pole-ortofoto.jpg" alt="" decoding="async" className="absolute inset-0 size-full object-cover object-[50%_40%]"/>
      <span className="absolute inset-0 bg-[linear-gradient(180deg,rgb(14_16_13/0.2),transparent_42%,rgb(14_16_13/0.24))]"/>
      <svg viewBox="0 0 420 204" preserveAspectRatio="none" className="absolute inset-0 size-full">
        <path d={PARCEL} fill="rgb(255 255 255 / 0.22)" className="tour-fade" style={after(1900)}/>
        <path d={PARCEL} pathLength="1" fill="none" stroke="white" strokeWidth="2.5" strokeLinejoin="round" className="tour-draw" style={after(1300)}/>
      </svg>
      <span className="tour-pin absolute left-[28.5%] top-[62%]" style={after(950)}>
        <MapPin className="size-8 fill-brand-700 text-white drop-shadow-[0_3px_4px_rgba(0,0,0,0.35)]" strokeWidth={1.5}/>
      </span>
    </div>
    <div className="tour-pop absolute left-3 top-3 flex h-[34px] items-center gap-2 rounded-[10px] bg-white/95 pl-2.5 pr-3 text-[12.5px] font-medium text-neutral-900 shadow-raised"
      style={after(150)}>
      <Search className="size-3.5 text-neutral-400" strokeWidth={2.25}/>
      <span className="tour-type whitespace-nowrap" style={after(350)}>Marki, Andersa 1</span>
    </div>
    <div className="absolute bottom-3 right-3 flex gap-1.5">
      {CROPS.map((crop, i) => <span key={crop} style={after(2250 + i * 90)}
        className={cn('tour-pop relative grid size-[42px] place-items-center rounded-xl bg-white shadow-raised', i === 1 ? 'ring-2 ring-brand-600' : 'ring-1 ring-black/[0.06]')}>
        <img src={`/design/${crop}.png`} alt="" width="32" height="32" decoding="async" className="size-8 object-contain"/>
        {i === 1 && <span className="tour-pop absolute -right-1.5 -top-1.5 grid size-[18px] place-items-center rounded-full bg-brand-700 text-white shadow-[0_1px_2px_rgb(13_35_23/0.3)]"
          style={after(2800)}><Check className="size-3" strokeWidth={3}/></span>}
      </span>)}
    </div>
  </Art>;
}

/** Krok 2: karta z zapasem wody jak w raporcie: liczba dolicza się, pasek rośnie, linia zapasu rysuje się do „dziś”. */
function WaterArt() {
  return <Art className="bg-[linear-gradient(165deg,var(--color-water-100),#f7f5ee_72%)]">
    <div className="tour-pop w-[80%] max-w-[330px] rounded-2xl bg-white p-3.5 shadow-raised ring-1 ring-black/[0.05]">
      <div className="flex items-center gap-3">
        <img src="/design/stan-obserwacja.png" alt="" width="44" height="44" decoding="async" className="size-11 shrink-0"/>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11.5px] font-medium text-neutral-500">Zapas wody <span className="font-normal text-neutral-400">· przykład</span></p>
          <p className="num mt-0.5 font-display text-[30px] font-semibold leading-none tracking-tight text-watch-ink">
            <CountUp to={58}/><span className="text-[19px]">%</span></p>
        </div>
        <span className="tour-pop shrink-0" style={after(900)}><StatusBadge tone="watch" size="sm">Obserwuj</StatusBadge></span>
      </div>
      <div className="relative mt-3 h-1.5 rounded-full bg-black/[0.06]">
        <span className="tour-grow absolute inset-y-0 left-0 w-[58%] rounded-full bg-watch" style={after(250)}/>
        <span className="absolute -bottom-1 -top-1 left-[42%] w-[2px] rounded-full bg-neutral-900"/>
      </div>
      <svg viewBox="0 0 300 46" className="mt-3 block h-[44px] w-full overflow-visible">
        <rect x="204" y="0" width="96" height="46" rx="4" fill="var(--color-water-50)"/>
        <path d="M0 38H300" stroke="var(--color-severe)" strokeWidth="1.25" strokeDasharray="2 3" opacity="0.7"/>
        <path d="M0 9C28 7 44 13 70 14S112 12 134 20S176 27 204 29" pathLength="1" fill="none" stroke="var(--color-watch)" strokeWidth="2.5"
          strokeLinecap="round" className="tour-draw" style={{ ...after(350), animationDuration: '1100ms' }}/>
        <g className="tour-fade" style={after(1350)}>
          <path d="M204 29C232 32 262 31 300 22" fill="none" stroke="var(--color-watch)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="5 5" opacity="0.85"/>
          <circle cx="204" cy="29" r="4.5" fill="var(--color-watch)" stroke="white" strokeWidth="2.5"/>
        </g>
      </svg>
    </div>
  </Art>;
}

// kolejność narzucona w raporcie: retencja, agrotechnika, na końcu nawadnianie (tytuły jak w zakładce Rekomendacje)
const ADVICE = [
  ['retencja', 'Zatrzymaj wodę na polu', 'najpierw', 'bg-brand-700 text-white'],
  ['agrotechnika', 'Zabiegi agrotechniczne', null, 'bg-brand-100 text-brand-800'],
  ['nawadnianie', 'Nawadnianie', 'na końcu', 'bg-neutral-100 text-neutral-600'],
];

/** Krok 3: trzy grupy zaleceń wchodzą po kolei, w tej samej kolejności co w raporcie. */
function AdviceArt() {
  return <Art className="bg-[linear-gradient(200deg,var(--color-brand-100),#f7f5ee_70%)]">
    <ol className="flex w-[78%] max-w-[330px] flex-col gap-1.5">
      {ADVICE.map(([image, title, tag, badge], i) => <li key={image} style={after(120 + i * 150)}
        className="tour-pop flex h-11 items-center gap-2.5 rounded-xl bg-white pl-2.5 pr-3 shadow-hairline ring-1 ring-black/[0.05]">
        <span className={cn('num grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold', badge)}>{i + 1}</span>
        <img src={`/design/akcja-${image}.png`} alt="" width="32" height="32" decoding="async" className="size-8 shrink-0 object-contain"/>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-900">{title}</span>
        {/* na telefonie kolejność mówią same numery: z plakietką nazwa by się nie zmieściła */}
        {tag && <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium max-md:hidden',
          i === 0 ? 'bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-600/15' : 'bg-neutral-100 text-neutral-600')}>{tag}</span>}
      </li>)}
    </ol>
  </Art>;
}

// ---------- kroki ----------

const PLAN_HINT = 'Plan podpowie, w które dni tygodnia są dobre warunki na wjazd w pole, siew, oprysk i nawożenie.';

const TOURS = {
  welcome: [
    { key: 'hero', art: HeroArt, eyebrow: 'WaterOS', title: 'Witaj w WaterOS', next: 'Zaczynamy',
      body: 'Sprawdzisz tu, czy Twoim polom brakuje wody, i dowiesz się, co z tym zrobić. Wystarczą trzy kroki.' },
    { key: 'find', art: FindArt, eyebrow: 'Krok 1', title: 'Wskaż swoje pole',
      body: 'Wpisz adres albo numer działki i kliknij pole na mapie. Wybierz uprawę, a pogodę, glebę i zdjęcia satelitarne pobierzemy sami.' },
    { key: 'water', art: WaterArt, eyebrow: 'Krok 2', title: 'Zobacz, ile wody ma pole',
      body: 'Raport pokazuje zapas wody w zasięgu korzeni: dziś, w ostatnich tygodniach i w prognozie. Kolor od razu mówi, czy trzeba działać.' },
    { key: 'advice', art: AdviceArt, eyebrow: 'Krok 3', title: 'Dowiedz się, co zrobić',
      body: 'Zalecenia są ułożone w kolejności: najpierw zatrzymanie wody na polu, potem zabiegi agrotechniczne, a nawadnianie na końcu. Każde wynika z danych Twojego pola.' },
    { key: 'nav', icon: { wide: MapIcon, narrow: Menu }, eyebrow: 'Na co dzień', title: 'Mapa pól i plan prac', prefer: 'right', pad: { wide: 2, narrow: 4 },
      target: { wide: '[data-tour="nav-map"], [data-tour="nav-plan"]', narrow: '[data-tour="menu"]' },
      body: { wide: `Na mapie zobaczysz wszystkie swoje pola. ${PLAN_HINT}`, narrow: `W menu jest mapa wszystkich pól i plan prac. ${PLAN_HINT}` } },
    { key: 'add', icon: Plus, eyebrow: 'Twoja kolej', title: 'Zacznij od dodania pola', target: '[data-tour="add"]',
      next: 'Dodaj pole', nextIcon: Plus, reason: 'add',
      body: 'To zajmie chwilę. Raport policzy się w tle, zwykle w ciągu minuty, i będzie odświeżany codziennie.' },
  ],
  report: [
    { key: 'verdict', icon: Droplet, eyebrow: 'Raport pola', title: 'Najważniejsze jest na górze',
      target: '[data-tour-panel="podsumowanie"] > div > section:first-child',
      body: 'Tu jest ocena sytuacji wodnej: ile wody ma gleba i czy uprawie grozi niedobór. Jeśli trzeba działać, zobaczysz tu też pierwsze zalecenie.' },
    { key: 'tabs', icon: Layers, eyebrow: 'Raport pola', title: 'Szczegóły są w zakładkach', target: '[data-tour="tabs"]', pad: 2, inset: 0,
      body: { wide: 'Wszystkie zalecenia, plan prac polowych, gleba, pogoda, teren i historia z 10 lat. W zakładce Źródła sprawdzisz, skąd pochodzą dane.',
        narrow: 'Wszystkie zalecenia, plan prac polowych, gleba, pogoda, teren i historia z 10 lat. Pasek zakładek przesuwa się w bok.' } },
    { key: 'actions', icon: Printer, eyebrow: 'Raport pola', title: 'Pobierz raport jako PDF', target: '[data-tour="report-actions"]',
      next: 'Gotowe', nextIcon: Check,
      body: 'Przycisk otwiera wydruk raportu, który możesz zapisać jako plik PDF. Pod trzema kropkami zmienisz uprawę i terminy albo usuniesz pole.' },
  ],
};

// obrazki ilustracji wczytane z góry, żeby krok nie pojawiał się z pustym miejscem
const PRELOAD = ['pole.webp', 'pierwsze-pole-ortofoto.jpg', 'stan-obserwacja.png', ...CROPS.map((crop) => `${crop}.png`),
  ...ADVICE.map(([image]) => `akcja-${image}.png`)];

// ---------- kiedy pokazać ----------

const AUTO_DELAY_MS = 700;   // po wejściu pulpitu albo raportu, nie w trakcie jego animacji
const NO_STORAGE = { getItem: () => null, setItem() {} };

function browserStorage() {
  try { return window.localStorage ?? NO_STORAGE; } catch { return NO_STORAGE; }
}

/**
 * Stan samouczka dla aplikacji. Sam pokazuje powitanie przy pierwszej wizycie na pulpicie i objaśnienie przy pierwszym
 * gotowym raporcie; `blocked` wstrzymuje start (otwarte okno, menu). `start(id)` uruchamia część ręcznie („Jak to działa”).
 */
export function useOnboarding({ ready, blocked, page, tab, hasReport }) {
  const [tour, setTour] = useState(null);
  const [seen, setSeen] = useState(() => readSeen(browserStorage()));
  const auto = ready && !blocked && !tour ? nextTour({ seen, page, tab, hasReport }) : null;
  const fits = tour === 'welcome' ? page === 'dashboard' : tour === 'report' ? page === 'field' && hasReport : true;

  const close = useCallback((reason) => {
    if (!tour) return;
    const marked = markSeen(browserStorage(), seenAfter(tour, reason));
    setSeen((current) => ({ ...current, ...marked }));
    setTour(null);
  }, [tour]);

  useEffect(() => {
    if (!auto) return;
    const timer = setTimeout(() => setTour(auto), AUTO_DELAY_MS);
    return () => clearTimeout(timer);
  }, [auto]);
  // zmiana widoku w trakcie (np. „wstecz” w przeglądarce): elementów do podświetlenia już nie ma
  useEffect(() => { if (!fits) close('done'); }, [fits, close]);

  return { tour, start: setTour, close };
}

// ---------- warstwa samouczka ----------

const CARD_W = 420, CARD_W_NARROW = 460, MARGIN = 12;
// przyklejone paski nad treścią (z odstępem 12 px): telefon ma nagłówek aplikacji (56 px) i zakładki raportu (44 px),
// komputer same zakładki. Krok może to nadpisać (`inset`), np. gdy celem jest sam przyklejony pasek.
const TOP_INSET = { narrow: 112, wide: 56 };
const GLIDE = { type: 'spring', duration: 0.55, bounce: 0.12 };
const INSTANT = { duration: 0 };
const LEAVE_MS = 170;

const swap = (shift) => ({
  enter: (direction) => ({ opacity: 0, x: shift * direction, filter: shift ? 'blur(4px)' : 'blur(0px)' }),
  center: { opacity: 1, x: 0, filter: 'blur(0px)', transition: { duration: 0.32, ease: EASE_OUT } },
  exit: (direction) => ({ opacity: 0, x: -shift * direction, filter: shift ? 'blur(4px)' : 'blur(0px)', transition: { duration: 0.16, ease: EASE_OUT } }),
});
const SWAP = swap(18), SWAP_REDUCED = swap(0);

const pick = (value, narrow) => (value && typeof value === 'object' && 'wide' in value ? (narrow ? value.narrow : value.wide) : value);

/** Widoczne elementy pasujące do selektora i ich wspólny prostokąt (współrzędne okna). */
function findTarget(selector) {
  const nodes = selector ? [...document.querySelectorAll(selector)].filter((node) => node.getClientRects().length) : [];
  const rect = unionRect(nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y, w: box.width, h: box.height };
  }));
  return { nodes, rect };
}

const sameRect = (a, b) => a === b || (a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5);

function TourLayer({ steps, narrow, onClose }) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [box, setBox] = useState(null);             // zmierzone: wolny obszar ekranu i wysokości części karty
  const [target, setTarget] = useState(undefined);  // undefined: jeszcze nie szukano; null: krok bez celu
  const [entered, setEntered] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const layer = useRef(null), card = useRef(null), footer = useRef(null);
  const stepNode = useRef(null);   // treść bieżącego kroku (poprzednia jeszcze znika obok, więc mierzymy tylko nową)
  const latest = useRef(box);
  latest.current = box;
  const closing = useRef(0);

  const step = steps[index];
  const last = index === steps.length - 1;
  const selector = pick(step.target, narrow) ?? null;
  const Icon = pick(step.icon, narrow);
  const NextIcon = step.nextIcon;
  const cardW = Math.min(narrow ? CARD_W_NARROW : CARD_W, (box?.w ?? Infinity) - 2 * MARGIN);

  useEffect(() => {
    for (const file of PRELOAD) new Image().src = `/design/${file}`;
    return () => clearTimeout(closing.current);
  }, []);

  // obszar ekranu (bez dolnego marginesu bezpieczeństwa telefonu) i naturalna wysokość treści oraz stopki karty
  useLayoutEffect(() => {
    function measure() {
      const node = layer.current;
      if (!node || !stepNode.current || !footer.current) return;
      const next = { w: node.clientWidth, h: node.clientHeight - (parseFloat(getComputedStyle(node).paddingBottom) || 0),
        contentH: stepNode.current.offsetHeight, footerH: footer.current.offsetHeight };
      setBox((old) => (old && old.w === next.w && old.h === next.h && old.contentH === next.contentH && old.footerH === next.footerH ? old : next));
    }
    measure();
    const observer = new ResizeObserver(measure);
    for (const ref of [layer, stepNode, footer]) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [index]);

  // cel kroku: znajdź, w razie potrzeby przewiń stronę tak, żeby był widoczny obok karty, i pilnuj jego położenia
  const measured = Boolean(box);
  useLayoutEffect(() => {
    if (!measured) return undefined;
    const found = findTarget(selector);
    if (!found.rect) { setTarget(null); return undefined; }
    const area = latest.current;
    const cardH = stepNode.current.offsetHeight + footer.current.offsetHeight;
    const delta = scrollDelta({ target: found.rect, card: { w: cardW, h: cardH }, area, narrow, prefer: step.prefer,
      topInset: step.inset ?? (narrow ? TOP_INSET.narrow : TOP_INSET.wide), scrollY: window.scrollY });
    const from = window.scrollY;
    const to = Math.min(Math.max(0, from + delta), Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
    const moved = Math.abs(to - from) > 1;
    if (moved) window.scrollTo({ top: to, behavior: reduced ? 'auto' : 'smooth' });
    // od razu położenie po przewinięciu: otwór i karta jadą prosto na miejsce, strona przewija się pod nimi
    setTarget(moved ? { ...found.rect, y: found.rect.y - (to - from) } : found.rect);

    let settled = !moved;
    function refresh() {
      const { rect } = findTarget(selector);
      if (rect) setTarget((old) => (sameRect(old, rect) ? old : rect));
    }
    function settle() { settled = true; refresh(); }
    function onChange() { if (settled) refresh(); }
    const timer = moved ? setTimeout(settle, 800) : 0;
    const observer = new ResizeObserver(onChange);
    for (const node of found.nodes) observer.observe(node);
    window.addEventListener('scrollend', settle);
    window.addEventListener('resize', onChange);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('scrollend', settle);
      window.removeEventListener('resize', onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wysokość karty i obszar czytane w chwili zmiany kroku
  }, [measured, selector, index, narrow]);

  const resolved = measured && target !== undefined;
  useEffect(() => {
    if (!resolved || entered) return undefined;
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [resolved, entered]);

  // po zmianie kroku fokus zostaje w karcie (przycisk „Wstecz” znika na pierwszym kroku)
  useEffect(() => {
    if (card.current && !card.current.contains(document.activeElement)) card.current.focus({ preventScroll: true });
  }, [index]);

  function leave(reason) {
    if (leaving) return;
    setLeaving(true);
    closing.current = setTimeout(() => onClose(reason), reduced ? 0 : LEAVE_MS);
  }
  // zamknięcie na ostatnim kroku to koniec samouczka, wcześniej pominięcie
  const dismiss = () => leave(last ? 'done' : 'skip');

  function go(next) {
    if (leaving || next < 0) return;
    if (next >= steps.length) { leave(step.reason ?? 'done'); return; }
    setDirection(next > index ? 1 : -1);
    setIndex(next);
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowRight' && !last) { event.preventDefault(); go(index + 1); }
    if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); go(index - 1); }
    if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); go(index + 1); }
  }

  const size = { w: cardW, h: box ? box.contentH + box.footerH : 0 };
  const placed = resolved ? placeCard({ target, card: size, area: box, narrow, prefer: step.prefer, margin: MARGIN })
    : { x: 0, y: 0, side: 'none' };
  // krok bez celu: otwór zwija się do punktu za kartą, więc przy następnym kroku „wyjeżdża” spod niej
  const hole = resolved && target ? spotlightRect({ target, area: box, placed, card: size, pad: pick(step.pad, narrow) ?? 6 })
    : { x: placed.x + size.w / 2, y: placed.y + size.h / 2, w: 0, h: 0 };
  const move = entered && !reduced ? GLIDE : INSTANT;
  const visible = entered && !leaving;

  return <>
      {/* Overlay blokuje przewijanie strony pod samouczkiem i łapie kliknięcia poza kartą */}
      <DialogPrimitive.Overlay className="no-print fixed inset-0 z-[90]"/>
      <div ref={layer} className={cn('no-print pointer-events-none fixed inset-0 z-[90] overflow-hidden pb-[env(safe-area-inset-bottom)]',
        'transition-opacity ease-out motion-reduce:transition-none', leaving ? 'duration-150' : 'duration-300', visible ? 'opacity-100' : 'opacity-0')}>
        {/* przyciemnienie to cień otworu; otwór jedzie między elementami tą samą sprężyną co karta */}
        <motion.div aria-hidden initial={false} className="absolute left-0 top-0 shadow-[0_0_0_200vmax_rgb(14_16_13/0.52)]"
          animate={{ x: hole.x, y: hole.y, width: hole.w, height: hole.h, borderRadius: target ? step.radius ?? 14 : 28 }} transition={move}>
          <span className={cn('tour-ring absolute inset-0 rounded-[inherit] transition-opacity duration-300 ease-out', target ? 'opacity-100' : 'opacity-0')}/>
        </motion.div>

        <DialogPrimitive.Content asChild onOpenAutoFocus={(event) => { event.preventDefault(); card.current?.focus({ preventScroll: true }); }}
          onEscapeKeyDown={(event) => { event.preventDefault(); dismiss(); }}
          onPointerDownOutside={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()}>
          <motion.div ref={card} tabIndex={-1} initial={false} animate={{ x: placed.x, y: placed.y }} transition={move} onKeyDown={onKeyDown}
            style={{ width: cardW }} className="pointer-events-auto absolute left-0 top-0 outline-none">
            <div className={cn('relative overflow-hidden rounded-[20px] bg-white shadow-overlay ring-1 ring-black/[0.06]',
              'transition-transform duration-[420ms] ease-out motion-reduce:transition-none',
              visible ? 'translate-y-0 scale-100' : entered ? 'scale-[0.98]' : 'translate-y-3 scale-[0.97]')}>
              <motion.div initial={false} className="overflow-hidden" animate={{ height: box ? box.contentH : 'auto' }} transition={move}>
                <div className="relative" aria-live="polite">
                  <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                    <motion.div key={step.key} custom={direction} variants={reduced ? SWAP_REDUCED : SWAP} initial="enter" animate="center" exit="exit">
                     <div ref={(node) => { if (node) stepNode.current = node; }}>
                      {step.art ? <step.art/> : null}
                      <div className="px-5 pt-5 md:px-6">
                        {!step.art && Icon && <span aria-hidden className="mb-4 grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/10">
                          <Icon className="size-5" strokeWidth={2}/></span>}
                        <p className="text-[12.5px] font-semibold text-brand-700">
                          {step.eyebrow}<span className="sr-only">, część {index + 1} z {steps.length}</span></p>
                        <DialogPrimitive.Title asChild>
                          <h2 className="mt-1.5 pr-8 font-display text-[22px] font-semibold leading-[1.15] tracking-tight text-neutral-950">{step.title}</h2>
                        </DialogPrimitive.Title>
                        <DialogPrimitive.Description asChild>
                          <p className="mt-2 text-[14.5px] leading-relaxed text-neutral-600">{pick(step.body, narrow)}</p>
                        </DialogPrimitive.Description>
                      </div>
                     </div>
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>

              {/* stopka poza wymienianą treścią: przyciski stoją w miejscu, więc kolejne kroki klika się bez szukania */}
              <div ref={footer} className="flex items-center gap-3 px-5 pb-5 pt-5 md:px-6 md:pb-6">
                <ol aria-hidden className="flex items-center gap-1.5">
                  {steps.map((entry, i) => <li key={entry.key} className={cn('h-1.5 rounded-full transition-[width,background-color] duration-300 ease-out',
                    i === index ? 'w-5 bg-brand-600' : i < index ? 'w-1.5 bg-brand-300' : 'w-1.5 bg-neutral-300')}/>)}
                </ol>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button variant="ghost" className="px-3 max-md:h-11" onClick={() => (index === 0 ? leave('skip') : go(index - 1))}>
                    {index === 0 ? 'Pomiń' : 'Wstecz'}</Button>
                  <Button className="min-w-[108px] max-md:h-11" onClick={() => go(index + 1)}
                    icon={NextIcon ? <NextIcon/> : undefined} iconRight={NextIcon ? undefined : <ArrowRight/>}>
                    {step.next ?? 'Dalej'}</Button>
                </div>
              </div>

              <button type="button" onClick={dismiss} aria-label="Zamknij samouczek"
                className="press absolute right-2.5 top-2.5 grid size-8 place-items-center rounded-full bg-white/85 text-neutral-600 shadow-hairline ring-1 ring-black/[0.06] backdrop-blur-sm hover:bg-white hover:text-neutral-950 after:absolute after:-inset-1.5">
                <X className="size-4" strokeWidth={2.25}/>
              </button>
            </div>
          </motion.div>
        </DialogPrimitive.Content>
      </div>
  </>;
}

/** Błąd w samouczku nie może zabrać ze sobą aplikacji: samouczek znika i nie wraca. */
class TourBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch() { this.props.onError(); }

  render() { return this.state.failed ? null : this.props.children; }
}

/**
 * Samouczek: `tour` to 'welcome' | 'report' | null (z `useOnboarding`), `narrow`: telefon.
 * `onClose(powód)`: 'add' (otwórz dodawanie pola) | 'done' | 'skip' | 'error'.
 */
export function Onboarding({ tour, narrow, onClose }) {
  if (!tour) return null;
  // warstwa jest osobnym komponentem wewnątrz portalu: jej pomiary ruszają dopiero, gdy elementy są już na stronie
  return <TourBoundary key={tour} onError={() => onClose('error')}>
    <DialogPrimitive.Root open modal>
      <DialogPrimitive.Portal>
        <TourLayer steps={TOURS[tour]} narrow={narrow} onClose={onClose}/>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  </TourBoundary>;
}
