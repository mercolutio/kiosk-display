import { login } from '../actions';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="container" style={{ maxWidth: 360, paddingTop: 80 }}>
      <div className="card">
        <h2>Kiosk-Verwaltung</h2>
        <form action={login}>
          <label htmlFor="password">Passwort</label>
          <input id="password" name="password" type="password" autoFocus style={{ width: '100%' }} />
          {error ? <p className="error">Falsches Passwort.</p> : null}
          <button className="btn-primary" type="submit" style={{ width: '100%', marginTop: 14 }}>
            Anmelden
          </button>
        </form>
      </div>
    </div>
  );
}
