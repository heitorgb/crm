import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

interface UserAvatarProps {
  name: string;
  src?: string;
  className?: string;
}

export function UserAvatar({ name, src, className }: UserAvatarProps) {
  return (
    <Avatar className={cn('size-8', className)}>
      {src ? <AvatarImage src={src} alt={name} /> : null}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
