import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { initials } from '@/lib/format';
import { useAuthenticatedImage } from '@/lib/use-authenticated-image';
import { cn } from '@/lib/utils';

interface AvatarShellProps {
  name: string;
  src?: string;
  className?: string;
}

interface UserAvatarProps {
  name: string;
  src?: string | null;
  authenticated?: boolean;
  className?: string;
}

function AvatarShell({ name, src, className }: AvatarShellProps) {
  return (
    <Avatar className={cn('size-8', className)}>
      {src ? <AvatarImage src={src} alt={name} /> : null}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

function AuthenticatedAvatar({ name, src, className }: AvatarShellProps) {
  const resolvedSrc = useAuthenticatedImage(src);
  return <AvatarShell name={name} src={resolvedSrc} className={className} />;
}

export function UserAvatar({ name, src, authenticated = false, className }: UserAvatarProps) {
  if (authenticated && src) {
    return <AuthenticatedAvatar name={name} src={src} className={className} />;
  }

  return <AvatarShell name={name} src={src ?? undefined} className={className} />;
}
