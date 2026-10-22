import { cn } from '@/lib/utils';

/** Already computed counts, with app-localized labels. No change-over-time mark. */
function CountsLine({ items = [], className, ...props }) {
  return <dl data-slot="counts-line" className={cn('flex flex-wrap items-center gap-x-6 gap-y-1 text-sm', className)} {...props}>
    {items.map(item => <div key={item.key ?? item.label} className="flex items-baseline gap-2"><dt className="text-muted-foreground">{item.label}</dt><dd className="font-semibold tabular-nums">{item.value}</dd></div>)}
  </dl>;
}
export { CountsLine };
