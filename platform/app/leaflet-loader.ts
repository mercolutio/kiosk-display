// Leaflet einmalig per CDN nachladen (kein npm-Paket noetig). Nur clientseitig
// aufrufen — window/document werden erst im Funktionsrumpf angefasst.
export function loadLeaflet(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.L) return resolve(w.L);
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    let script = document.getElementById('leaflet-js') as HTMLScriptElement | null;
    if (script) {
      script.addEventListener('load', () => resolve(w.L));
      script.addEventListener('error', reject);
      return;
    }
    script = document.createElement('script');
    script.id = 'leaflet-js';
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true;
    script.onload = () => resolve(w.L);
    script.onerror = reject;
    document.body.appendChild(script);
  });
}
