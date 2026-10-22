import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface LandingLinkButtonProps {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'lg';
  className?: string;
  onClick?: () => void;
}

const baseClasses =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-[background-color,border-color,color,filter,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#080a0f] [&_svg]:size-4 [&_svg]:shrink-0';

const variantClasses = {
  primary: 'landing-button-primary text-emerald-950',
  secondary: 'landing-button-secondary text-white/85 hover:text-white',
};

const sizeClasses = {
  sm: 'h-9 px-4 text-[13px]',
  lg: 'h-12 px-6 text-sm',
};

export function LandingLinkButton({
  href,
  children,
  variant = 'primary',
  size = 'lg',
  className,
  onClick,
}: LandingLinkButtonProps) {
  const classes = cn(baseClasses, variantClasses[variant], sizeClasses[size], className);
  const isExternal = /^https?:/i.test(href) || href.startsWith('mailto:');

  if (isExternal || href.startsWith('#')) {
    return (
      <a
        href={href}
        onClick={onClick}
        className={classes}
        target={isExternal && href.startsWith('http') ? '_blank' : undefined}
        rel={isExternal && href.startsWith('http') ? 'noopener noreferrer' : undefined}
      >
        {children}
      </a>
    );
  }

  return (
    <Link to={href} onClick={onClick} className={classes}>
      {children}
    </Link>
  );
}
