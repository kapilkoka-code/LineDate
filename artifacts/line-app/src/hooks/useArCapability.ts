import { useEffect, useMemo, useState } from 'react';
import {
  detectWorldArSupport,
  selectArCapability,
  type ArCapabilityState,
  type WorldArSupport,
} from '@/services/arCapabilities';

type UseArCapabilityOptions = {
  cameraAvailable: boolean;
  trustedHeadingAvailable: boolean;
};

type ArCapabilityResult = {
  state: ArCapabilityState;
  worldArSupport: WorldArSupport;
};

export function useArCapability({
  cameraAvailable,
  trustedHeadingAvailable,
}: UseArCapabilityOptions): ArCapabilityResult {
  const [worldArSupport, setWorldArSupport] = useState<WorldArSupport>('checking');

  useEffect(() => {
    let active = true;
    void detectWorldArSupport().then((support) => {
      if (active) setWorldArSupport(support);
    });
    return () => {
      active = false;
    };
  }, []);

  const state = useMemo(
    () => selectArCapability({
      worldArSupport,
      cameraAvailable,
      trustedHeadingAvailable,
    }),
    [cameraAvailable, trustedHeadingAvailable, worldArSupport],
  );

  return { state, worldArSupport };
}