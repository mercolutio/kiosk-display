'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Aktualisiert die aktuelle Seite (Server-Komponenten) regelmaessig im Hintergrund
// per soft refresh — so wird der Geraete-Status live, ohne manuelles Neuladen (F5).
export default function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
