'use client';
// Vertrag/Dokument hochladen: Datei -> /api/upload (Server -> Vercel Blob) mit
// Fortschritt, danach Formular an die Server-Action addContract.
import { useState, type ChangeEvent } from 'react';
import { addContract } from '../actions';

const MAX = 4.4 * 1024 * 1024; // ~Vercel-Function-Body-Limit (4,5 MB)

function uploadViaXhr(file: File, onProgress: (p: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload?filename=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
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
    xhr.send(file);
  });
}

export default function ContractUploadForm({ devices }: { devices: { id: string; name: string }[] }) {
  const [url, setUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [name, setName] = useState('');
  const [ctype, setCtype] = useState('');
  const [size, setSize] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(''); setUrl(''); setProgress(0);
    if (file.size > MAX) { setError('Datei zu groß (max ~4,5 MB)'); return; }
    setUploading(true);
    try {
      const u = await uploadViaXhr(file, setProgress);
      setUrl(u);
      setFileName(file.name);
      setCtype(file.type || '');
      setSize(file.size);
      if (!name) setName(file.name.replace(/\.[^.]+$/, ''));
    } catch (err: any) {
      setError(err?.message || 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
    }
  }

  return (
    <form action={addContract} className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <input type="hidden" name="url" value={url} />
      <input type="hidden" name="content_type" value={ctype} />
      <input type="hidden" name="size" value={size} />
      <div style={{ minWidth: 220 }}>
        <input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,application/pdf,image/*" onChange={onFile} />
        {uploading && <span className="muted" style={{ marginLeft: 8 }}>lädt hoch… {progress}%</span>}
        {url && <span style={{ marginLeft: 8, color: '#34c759', fontSize: 13 }}>✓ {fileName}</span>}
        {error && <div className="error" style={{ marginTop: 4 }}>{error}</div>}
      </div>
      <input name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bezeichnung" required style={{ width: 200 }} />
      <select name="category" defaultValue="blanko" style={{ width: 150 }}>
        <option value="blanko">Blanko</option>
        <option value="unterschrieben">Unterschrieben</option>
      </select>
      <select name="device_id" defaultValue="" style={{ width: 170 }}>
        <option value="">— kein Gerät —</option>
        {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <input name="note" placeholder="Notiz (optional)" style={{ flex: 1, minWidth: 160 }} />
      <button className="btn-primary btn-sm" type="submit" disabled={uploading || !url}>+ Vertrag</button>
    </form>
  );
}
