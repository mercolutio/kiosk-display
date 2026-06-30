'use client';
// PDF im Browser ausfüllen: pdf.js rendert die Seiten, der Nutzer setzt per Klick
// Textfelder, tippt rein und zieht sie zurecht; pdf-lib stempelt den Text beim
// Download an dieselben Stellen ins Original-PDF. Beide Libs per CDN geladen
// (keine npm-Abhängigkeit, kein Bundling-Aufwand).
import { useEffect, useRef, useState } from 'react';

function loadScript(src: string, globalName: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w[globalName]) return resolve(w[globalName]);
    const sel = `script[data-g="${globalName}"]`;
    const existing = document.querySelector(sel) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(w[globalName]));
      existing.addEventListener('error', () => reject(new Error('Laden fehlgeschlagen')));
      return;
    }
    const s = document.createElement('script');
    s.src = src; s.async = true; s.dataset.g = globalName;
    s.onload = () => resolve(w[globalName]);
    s.onerror = () => reject(new Error('Konnte Bibliothek nicht laden'));
    document.body.appendChild(s);
  });
}

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const PDFLIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
const DISPLAY_SCALE = 1.4; // Anzeige-Pixel pro PDF-Punkt

type Field = { id: number; page: number; xFrac: number; yFrac: number; text: string; size: number };
type PageInfo = { dataUrl: string; wPt: number; hPt: number };

export default function PdfFiller({ fileUrl, downloadName }: { fileUrl: string; downloadName: string }) {
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [size, setSize] = useState(11);
  const idRef = useRef(1);
  const draggingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pdfjsLib] = await Promise.all([loadScript(PDFJS, 'pdfjsLib'), loadScript(PDFLIB, 'PDFLib')]);
        pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        const data = await fetch(fileUrl).then((r) => {
          if (!r.ok) throw new Error('Datei nicht ladbar (' + r.status + ')');
          return r.arrayBuffer();
        });
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        const out: PageInfo[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const vp1 = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: DISPLAY_SCALE });
          const canvas = document.createElement('canvas');
          canvas.width = vp.width; canvas.height = vp.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas nicht verfügbar');
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          out.push({ dataUrl: canvas.toDataURL('image/png'), wPt: vp1.width, hPt: vp1.height });
        }
        if (!cancelled) { setPages(out); setStatus('ready'); }
      } catch (e: any) {
        if (!cancelled) { setErrorMsg(e?.message || 'Fehler'); setStatus('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [fileUrl]);

  function addField(pageIdx: number, e: React.MouseEvent<HTMLDivElement>) {
    if (draggingRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xFrac = (e.clientX - rect.left) / rect.width;
    const yFrac = (e.clientY - rect.top) / rect.height;
    const id = idRef.current++;
    setFields((f) => [...f, { id, page: pageIdx, xFrac, yFrac, text: '', size }]);
  }
  const update = (id: number, patch: Partial<Field>) =>
    setFields((f) => f.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const remove = (id: number) => setFields((f) => f.filter((x) => x.id !== id));

  function onDragStart(id: number, overlay: HTMLElement, ev: React.MouseEvent) {
    ev.preventDefault(); ev.stopPropagation();
    draggingRef.current = true;
    const move = (m: MouseEvent) => {
      const rect = overlay.getBoundingClientRect();
      update(id, {
        xFrac: Math.min(1, Math.max(0, (m.clientX - rect.left) / rect.width)),
        yFrac: Math.min(1, Math.max(0, (m.clientY - rect.top) / rect.height)),
      });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setTimeout(() => { draggingRef.current = false; }, 0);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  async function download() {
    try {
      const PDFLib = (window as any).PDFLib;
      const bytes = await fetch(fileUrl).then((r) => r.arrayBuffer());
      const doc = await PDFLib.PDFDocument.load(bytes);
      const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      const ps = doc.getPages();
      for (const f of fields) {
        const t = f.text.trim();
        if (!t) continue;
        const p = ps[f.page];
        if (!p) continue;
        const { width, height } = p.getSize();
        try {
          p.drawText(t, {
            x: f.xFrac * width,
            y: height - f.yFrac * height - f.size,
            size: f.size,
            font,
            color: PDFLib.rgb(0.05, 0.05, 0.05),
          });
        } catch { /* nicht unterstütztes Zeichen -> überspringen */ }
      }
      const outBytes = await doc.save();
      const blob = new Blob([outBytes], { type: 'application/pdf' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = downloadName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e: any) {
      alert('Download fehlgeschlagen: ' + (e?.message || 'Fehler'));
    }
  }

  if (status === 'loading') return <p className="muted">PDF wird geladen…</p>;
  if (status === 'error') return <p className="error">Konnte das PDF nicht laden: {errorMsg}</p>;

  return (
    <div>
      <div className="row" style={{ gap: 12, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 13, flex: 1, minWidth: 200 }}>
          Klick ins Dokument, um ein Textfeld zu setzen · tippen · mit ⠿ ziehen · × entfernt.
        </span>
        <label className="row" style={{ gap: 6, margin: 0, fontSize: 13 }}>
          Schrift
          <select value={size} onChange={(e) => setSize(parseInt(e.target.value, 10))} style={{ width: 90 }}>
            <option value={9}>klein</option>
            <option value={11}>normal</option>
            <option value={14}>groß</option>
          </select>
        </label>
        <button className="btn-primary btn-sm" type="button" onClick={download}>⬇ Ausgefülltes PDF</button>
      </div>

      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        {pages.map((pg, idx) => {
          const dispW = pg.wPt * DISPLAY_SCALE;
          const dispH = pg.hPt * DISPLAY_SCALE;
          return (
            <div key={idx} style={{ position: 'relative', width: dispW, height: dispH, margin: '0 auto 16px', boxShadow: '0 0 0 1px #333', background: '#fff' }}>
              <img src={pg.dataUrl} width={dispW} height={dispH} alt={`Seite ${idx + 1}`} style={{ display: 'block', userSelect: 'none', pointerEvents: 'none' }} />
              <div onClick={(e) => addField(idx, e)} style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }}>
                {fields.filter((f) => f.page === idx).map((f) => (
                  <div key={f.id} onClick={(e) => e.stopPropagation()}
                       style={{ position: 'absolute', left: f.xFrac * 100 + '%', top: f.yFrac * 100 + '%', display: 'inline-flex', alignItems: 'center', gap: 1, background: 'rgba(52,199,89,.10)', border: '1px solid #34c759', borderRadius: 3, whiteSpace: 'nowrap' }}>
                    <span title="ziehen" onMouseDown={(e) => onDragStart(f.id, e.currentTarget.parentElement!.parentElement!, e)}
                          style={{ cursor: 'move', padding: '0 3px', color: '#1f8f44', userSelect: 'none', fontSize: 12 }}>⠿</span>
                    <input value={f.text} onChange={(e) => update(f.id, { text: e.target.value })} autoFocus placeholder="Text…"
                           style={{ border: 'none', background: 'transparent', color: '#0a0a0a', fontSize: f.size * DISPLAY_SCALE, lineHeight: 1.1, padding: 0, minWidth: 44, outline: 'none' }} />
                    <span title="entfernen" onClick={() => remove(f.id)} style={{ cursor: 'pointer', color: '#c0392b', padding: '0 4px', userSelect: 'none' }}>×</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
