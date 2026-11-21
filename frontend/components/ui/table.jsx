import { cn } from '@/lib/utils';

/** Tabela danych: nagłówki jak mikro-etykiety. Cyfry równej szerokości (`num`) tylko w komórkach liczbowych. `scroll`: przewijanie w poziomie. */
export function Table({ className, scroll, minWidth, children, ...props }) {
  const table = <table className={cn('w-full border-collapse text-left text-[13.5px] text-neutral-700', className)}
    style={minWidth ? { minWidth } : undefined} {...props}>{children}</table>;
  return scroll ? <div className="-mx-1 overflow-x-auto px-1">{table}</div> : table;
}
export function THead(props) { return <thead {...props}/>; }
export function TBody(props) { return <tbody {...props}/>; }
export function TR({ className, ...props }) {
  return <tr className={cn('border-b border-black/[0.06] last:border-0', className)} {...props}/>;
}
export function TH({ className, ...props }) {
  return <th className={cn('eyebrow border-b border-black/[0.08] py-2.5 pr-4 font-medium last:pr-0', className)} {...props}/>;
}
export function TD({ className, ...props }) {
  return <td className={cn('py-2.5 pr-4 align-top last:pr-0', className)} {...props}/>;
}
export function Caption({ className, ...props }) {
  return <caption className={cn('caption-bottom pt-2.5 text-left text-[12px] text-neutral-500', className)} {...props}/>;
}
