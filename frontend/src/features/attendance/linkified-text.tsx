import { linkifyText } from './linkify-text';

interface LinkifiedTextProps {
  text: string;
  className?: string;
}

export function LinkifiedText({ text, className }: LinkifiedTextProps) {
  const segments = linkifyText(text);

  return (
    <p className={className}>
      {segments.map((segment, index) =>
        segment.type === 'link' ? (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-info underline underline-offset-2 hover:opacity-80"
          >
            {segment.value}
          </a>
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </p>
  );
}
