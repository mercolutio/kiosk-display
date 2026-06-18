'use client';
import { useState, type ChangeEvent } from 'react';
import { addSite } from '../../actions';

const MAX_DIRECT = 4.4 * 1024 * 1024; // ~Vercel-Function-Body-Limit (4,5 MB)

// Bild im Browser auf max. 1920 px (JPEG) verkleinern -> passt fuers Display und
// bleibt klar unter dem Upload-Limit.
// Bildquelle schnell dekodieren: createImageBitmap (effizient, ohne Base64,
// dekodiert die Datei direkt); Fallback ueber Object-URL fuer exotische Faelle.
async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* Fallback unten */ }
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht geladen werden')); };
    img.src = url;
  });
}

function resizeImage(file: File, maxDim = 1920): Promise<Blob> {
  return decodeImage(file).then((src) => {
    let width = (src as ImageBitmap).width;
    let height = (src as ImageBitmap).height;
    if (Math.max(width, height) > maxDim) {
      const s = maxDim / Math.max(width, height);
      width = Math.round(width * s);
      height = Math.round(height * s);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas nicht verfügbar');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src as CanvasImageSource, 0, 0, width, height);
    if ('close' in src) (src as ImageBitmap).close();
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht konvertiert werden'))),
        'image/jpeg',
        0.85,
      ),
    );
  });
}

// Datei serverseitig hochladen (POST an /api/upload) mit Fortschritt via XHR.
function uploadViaXhr(body: Blob, filename: string, onProgress: (p: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload?filename=${encodeURIComponent(filename)}`);
    xhr.setRequestHeader('Content-Type', body.type || 'application/octet-stream');
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText).url); }
        catch { reject(new Error('ungültige Server-Antwort')); }
      } else if (xhr.status === 413) {
        reject(new Error('Datei zu groß (max ~4,5 MB)'));
      } else {
        let msg = 'Fehler ' + xhr.status;
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Netzwerkfehler beim Upload'));
    xhr.send(body);
  });
}

// Seite hinzufuegen: Webseite (URL) ODER Bild/Video (Datei -> Server -> Vercel Blob).
export default function AddSiteForm({ deviceId }: { deviceId: string }) {
  const [type, setType] = useState<'web' | 'image' | 'video'>('web');
  const [uploading, setUploading] = useState(false);
  const [mediaUrl, setMediaUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [processing, setProcessing] = useState(false);

  function reset() { setMediaUrl(''); setFileName(''); setError(''); setProgress(0); setProcessing(false); }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    setUploading(true);
    try {
      let body: Blob = file;
      let name = file.name;
      if (type === 'image') {
        setProcessing(true);
        body = await resizeImage(file);
        setProcessing(false);
        name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
      } else if (body.size > MAX_DIRECT) {
        throw new Error('Video zu groß (max ~4,5 MB). Bitte kürzer/kleiner komprimieren.');
      }
      const url = await uploadViaXhr(body, name, setProgress);
      setMediaUrl(url);
      setFileName(file.name);
    } catch (err: any) {
      setError(err?.message || 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  }

  return (
    <form action={addSite} className="row" style={{ marginTop: 6, alignItems: 'flex-start' }}>
      <input type="hidden" name="device_id" value={deviceId} />
      <input type="hidden" name="type" value={type} />
      <select value={type} onChange={(e) => { setType(e.target.value as any); reset(); }} style={{ width: 110 }}>
        <option value="web">Webseite</option>
        <option value="image">Bild</option>
        <option value="video">Video</option>
      </select>
      <input name="name" placeholder="Name" required style={{ width: 140 }} />
      {type === 'web' ? (
        <input name="url" placeholder="https://…" required style={{ flex: 1, minWidth: 160 }} />
      ) : (
        <div style={{ flex: 1, minWidth: 160 }}>
          <input type="file" accept={type === 'image' ? 'image/*' : 'video/*'} onChange={onFile} />
          <input type="hidden" name="url" value={mediaUrl} />
          {uploading && <span className="muted" style={{ marginLeft: 8 }}>{processing ? 'verarbeite Bild…' : `lädt hoch… ${progress}%`}</span>}
          {mediaUrl && <span style={{ marginLeft: 8, color: '#34c759', fontSize: 13 }}>✓ {fileName}</span>}
          {error && <div className="error" style={{ marginTop: 4 }}>{error}</div>}
        </div>
      )}
      <input name="duration" type="number" min="1" placeholder="Dauer s" style={{ width: 90 }} />
      <button className="btn-primary btn-sm" type="submit" disabled={uploading || (type !== 'web' && !mediaUrl)}>+ Seite</button>
    </form>
  );
}
