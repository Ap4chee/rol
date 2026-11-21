import { useLayoutEffect, useRef, useState } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

/**
 * Lista zakładek z kreską pod aktywną. Kreska jedzie samym transform (translateX + scaleX), bez animowania szerokości,
 * a przy pierwszym rysowaniu stoi od razu na miejscu. Na wąskim ekranie lista przewija się w poziomie.
 */
export function TabsList({ className, children, value, ...props }) {
  const list = useRef(null);
  const [bar, setBar] = useState(null);
  const ready = useRef(false);

  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    function measure() {
      const active = node.querySelector('[role="tab"][data-state="active"]');
      if (!active) { setBar(null); return; }
      setBar({ x: active.offsetLeft, w: active.offsetWidth });
    }
    measure();
    // Obserwujemy też same zakładki: po wczytaniu fontu zmienia się ich szerokość, a szerokość listy nie.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    node.querySelectorAll('[role="tab"]').forEach((tab) => observer.observe(tab));
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) measure(); });
    return () => { alive = false; observer.disconnect(); };
  }, [value]);

  useLayoutEffect(() => {
    if (!bar) return;
    const node = list.current;
    const active = node?.querySelector('[role="tab"][data-state="active"]');
    if (active && node.scrollWidth > node.clientWidth) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const id = requestAnimationFrame(() => { ready.current = true; });
    return () => cancelAnimationFrame(id);
  }, [bar]);

  return <TabsPrimitive.List ref={list} className={cn('scrollbar-none relative flex overflow-x-auto', className)} {...props}>
    {children}
    {bar && <span aria-hidden className={cn('pointer-events-none absolute bottom-0 left-0 h-[2px] w-[100px] origin-left rounded-full bg-neutral-950',
      ready.current && 'transition-transform duration-[260ms] ease-out')}
      style={{ transform: `translateX(${bar.x}px) scaleX(${bar.w / 100})` }}/>}
  </TabsPrimitive.List>;
}

export function TabsTrigger({ className, children, count, ...props }) {
  return <TabsPrimitive.Trigger className={cn(
    'group relative inline-flex h-11 shrink-0 items-center gap-1.5 px-3 text-[13.5px] font-medium text-neutral-500 transition-colors duration-150 focus-visible:outline-solid',
    'hover:text-neutral-900 data-[state=active]:text-neutral-950 focus-visible:rounded-md focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-brand-600',
    className)} {...props}>
    {children}
    {count ? <span className="num rounded-full bg-black/[0.06] px-1.5 py-0.5 text-[11px] font-semibold leading-none text-neutral-600 group-data-[state=active]:bg-brand-700 group-data-[state=active]:text-white">{count}</span> : null}
  </TabsPrimitive.Trigger>;
}
