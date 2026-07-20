import { useState } from "react";
import { LockClosedIcon } from "@heroicons/react/24/outline";
import { api } from "./api";
import { Aurora } from "./Layout";

export function MfaGate({
  onVerified,
  onLogout,
}: {
  onVerified: () => void;
  onLogout: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.mfaVerify(code.trim());
      onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : "invalid code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-root">
      <Aurora />
      <main className="shell" style={{ maxWidth: 420, margin: "4rem auto" }}>
        <div className="panel" style={{ padding: "1.5rem" }}>
          <p className="section-label">
            <LockClosedIcon className="inline-icon" aria-hidden /> Authenticator
          </p>
          <h1 style={{ fontSize: "1.35rem", margin: "0.35rem 0 0.5rem" }}>Enter your MFA code</h1>
          <p className="muted" style={{ marginBottom: "1rem" }}>
            Open your authenticator app and enter the 6-digit code for VaultMCP.
          </p>
          <form onSubmit={(e) => void submit(e)}>
            <label className="field">
              <span>Code</span>
              <input
                className="input mono"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,12}"
                maxLength={12}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                autoFocus
                required
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="mfa-setup-actions" style={{ marginTop: "1rem" }}>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? "Checking…" : "Continue"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => void onLogout()}>
                Sign out
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

export function MfaSettingsPanel({
  enabled,
  onChanged,
}: {
  enabled: boolean;
  onChanged: (enabled: boolean) => void;
}) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function startSetup() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const s = await api.mfaSetup();
      setSetup(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "setup failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api.mfaConfirm(code.trim());
      setSetup(null);
      setCode("");
      setNotice("Authenticator MFA is on.");
      onChanged(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "invalid code");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      await api.mfaDisable(code.trim());
      setCode("");
      setNotice("Authenticator MFA is off.");
      onChanged(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "invalid code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel mfa-panel" id="account-mfa">
      <header className="panel-head mfa-panel-head">
        <div>
          <p className="section-label">
            <LockClosedIcon className="inline-icon" aria-hidden /> Account security
          </p>
          <h2>Authenticator MFA</h2>
          <p className="muted">
            Optional TOTP after GitHub sign-in for the dashboard. IDE MCP tokens are separate.
          </p>
        </div>
      </header>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="form-error">{error}</p>}

      {!enabled && !setup && (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void startSetup()}>
          {busy ? "…" : "Set up authenticator"}
        </button>
      )}

      {setup && (
        <div className="mfa-setup">
          <div className="mfa-setup-qr">
            <p className="mfa-setup-label">1. Scan QR code</p>
            <img
              className="mfa-qr"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(setup.otpauthUrl)}`}
              width={180}
              height={180}
              alt="MFA QR code"
            />
            <p className="mfa-manual mono">
              <span className="mfa-manual-label">Manual key</span>
              <span className="mfa-manual-value">{setup.secret}</span>
            </p>
          </div>
          <div className="mfa-setup-confirm">
            <p className="mfa-setup-label">2. Confirm with a code</p>
            <label className="field">
              <span className="field-label">6-digit code</span>
              <input
                className="input mono"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={12}
              />
            </label>
            <div className="mfa-setup-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void confirm()}>
                Enable MFA
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setSetup(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {enabled && !setup && (
        <div className="mfa-disable">
          <p className="notice">
            MFA is <strong>on</strong>. Enter a code to disable.
          </p>
          <label className="field">
            <span className="field-label">Authenticator code</span>
            <input
              className="input mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={12}
            />
          </label>
          <div className="mfa-setup-actions">
            <button
              type="button"
              className="btn btn-danger btn-danger-quiet"
              disabled={busy}
              onClick={() => void disable()}
            >
              Disable MFA
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// keep file focused on MFA UI
