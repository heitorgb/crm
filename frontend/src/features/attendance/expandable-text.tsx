import { useMemo, useState } from 'react';
import { LinkifiedText } from './linkified-text';
import {
  INITIAL_MESSAGE_VISIBLE_CHARS,
  MESSAGE_EXPANSION_STEP,
  truncateMessageText,
} from './message-expansion';

interface ExpandableTextProps {
  text: string;
  className?: string;
}

export function ExpandableText({ text, className }: ExpandableTextProps) {
  const [visibleChars, setVisibleChars] = useState(INITIAL_MESSAGE_VISIBLE_CHARS);
  const { text: visibleText, hasHiddenContent } = useMemo(
    () => truncateMessageText(text, visibleChars),
    [text, visibleChars],
  );

  return (
    <>
      <LinkifiedText text={visibleText} className={className} />
      {hasHiddenContent ? (
        <button
          type="button"
          className="mt-0.5 inline-flex rounded-sm text-xs font-medium text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setVisibleChars((current) => current + MESSAGE_EXPANSION_STEP)}
        >
          Ler mais
        </button>
      ) : null}
    </>
  );
}
