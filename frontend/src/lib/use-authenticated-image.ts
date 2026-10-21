import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequestBlob } from './api-client';

export function useAuthenticatedImage(src: string | null | undefined): string | undefined {
  const query = useQuery({
    queryKey: ['authenticated-image', src],
    queryFn: () => apiRequestBlob(src as string),
    enabled: Boolean(src),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const objectUrl = useMemo(
    () => (query.data ? URL.createObjectURL(query.data) : undefined),
    [query.data],
  );

  useEffect(
    () => () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    },
    [objectUrl],
  );

  return objectUrl;
}
