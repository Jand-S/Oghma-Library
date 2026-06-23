import { useEffect, useState } from "react";
import type { KindleDeviceStatus } from "../core/types";
import { detectKindleDevice } from "../services/localFiles";

export function useKindleDetection(loading: boolean) {
  const [kindleStatus, setKindleStatus] = useState<KindleDeviceStatus | null>(null);
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    const refresh = () => {
      void detectKindleDevice()
        .then((status) => {
          if (!cancelled && status) setKindleStatus(status);
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loading]);
  return { kindleStatus, setKindleStatus };
}
