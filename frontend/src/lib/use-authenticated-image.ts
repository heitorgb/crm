import { useEffect, useState } from 'react';
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
  const [objectUrl, setObjectUrl] = useState<string>();

  useEffect(() => {
    if (!query.data) {
      return undefined;
    }

    const url = URL.createObjectURL(query.data);
    // Object URLs are external resources, so they must be created and revoked
    // inside the effect to survive StrictMode's mount/unmount/remount cycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setObjectUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [query.data]);

  return objectUrl;
}
