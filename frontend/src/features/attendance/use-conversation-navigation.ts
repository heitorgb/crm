import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useConversationNavigation() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedConversationId = searchParams.get('conversation');

  const selectConversation = useCallback(
    (id: string): void => {
      setSearchParams(
        { conversation: id },
        { replace: selectedConversationId !== null },
      );
    },
    [selectedConversationId, setSearchParams],
  );

  const deselectConversation = useCallback((): void => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  return { selectedConversationId, selectConversation, deselectConversation };
}
