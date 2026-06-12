'use client';
import { useState, type ChangeEvent } from 'react';
import { upload } from '@vercel/blob/client';
import { addSite } from '../../actions';

// Seite hinzufuegen: Webseite (URL) ODER Bild/Video (Datei -> Vercel Blob).
export default function AddSiteForm({ deviceId }: { deviceId: string }) {
  const [type, setType] = useState<'web' | 'image' | 'video'>('web');
  const [uploading, setUploading] = useState(false);
  const [mediaUrl, setMediaUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);

  function reset() { setMediaUrl(''); setFileName(''); setError(''); setProgress(0); }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    setUploading(true);
    try {
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/upload',
        multipart: true,
        onUploadProgress: (p) => setProgress(Math.round(p.percentage)),
      });
      setMediaUrl(blob.url);
      setFileName(file.name);
    } catch (err: any) {
      setError(err?.message || 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
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
          {uploading && <span className="muted" style={{ marginLeft: 8 }}>lädt hoch… {progress}%</span>}
          {mediaUrl && <span style={{ marginLeft: 8, color: '#34c759', fontSize: 13 }}>✓ {fileName}</span>}
          {error && <div className="error" style={{ marginTop: 4 }}>{error}</div>}
        </div>
      )}
      <input name="duration" type="number" min="1" placeholder="Dauer s" style={{ width: 90 }} />
      <button className="btn-primary btn-sm" type="submit" disabled={uploading || (type !== 'web' && !mediaUrl)}>+ Seite</button>
    </form>
  );
}
