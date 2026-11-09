import { useAuthenticatedImage } from '@/lib/use-authenticated-image';
import { cn } from '@/lib/utils';

type StoreLogoProps = {
  store: { id: string; name: string; logoUpdatedAt: string | null };
  className?: string;
};

export function StoreLogo({ store, className }: StoreLogoProps) {
  const src = store.logoUpdatedAt
    ? `/store-orders/stores/${store.id}/logo?v=${encodeURIComponent(store.logoUpdatedAt)}`
    : null;
  const image = useAuthenticatedImage(src);

  return <span className={cn('flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white text-sm font-bold text-primary ring-1 ring-border/70', className)}>
    {image ? <img src={image} alt={`Logo da ${store.name}`} className="size-full object-contain p-1" /> : store.name.slice(0, 2).toUpperCase()}
  </span>;
}
