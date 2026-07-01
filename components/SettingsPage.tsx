"use client";

import { ArrowLeft, CheckCircle2, Github, KeyRound, Loader2, Save, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { readJsonResponse } from "@/lib/client/apiFetch";

type PublicSettings = {
  authMode: "token" | "oauth";
  appUrl: string;
  githubClientId: string;
  hasGithubClientSecret: boolean;
  hasPersonalAccessToken: boolean;
  hasSessionSecret: boolean;
  githubConfigured: boolean;
  missing: string[];
  updatedAt?: string;
};

export function SettingsPage() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [authMode, setAuthMode] = useState<"token" | "oauth">("token");
  const [appUrl, setAppUrl] = useState("http://localhost:3000");
  const [githubClientId, setGithubClientId] = useState("");
  const [githubClientSecret, setGithubClientSecret] = useState("");
  const [personalAccessToken, setPersonalAccessToken] = useState("");
  const [sessionSecret, setSessionSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void loadSettings();
  }, []);

  const callbackUrl = useMemo(() => `${appUrl.replace(/\/$/, "")}/api/auth/github/callback`, [appUrl]);

  async function loadSettings() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/settings/github", { cache: "no-store" });
      const data = await readJsonResponse<PublicSettings>(response, "Unable to load settings.");

      setSettings(data);
      setAuthMode(data.authMode);
      setAppUrl(data.appUrl);
      setGithubClientId(data.githubClientId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load settings.");
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/settings/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authMode,
          appUrl,
          githubClientId,
          githubClientSecret,
          personalAccessToken,
          sessionSecret
        })
      });
      const data = await readJsonResponse<PublicSettings>(response, "Unable to save settings.");

      setSettings(data);
      setGithubClientSecret("");
      setPersonalAccessToken("");
      setSessionSecret("");
      setMessage(authMode === "token" ? "Token saved. GitHub is connected." : "Settings saved. GitHub sign-in is ready.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save settings.");
    } finally {
      setSaving(false);
    }
  }

  function generateSessionSecret() {
    const bytes = new Uint8Array(48);
    crypto.getRandomValues(bytes);
    setSessionSecret(base64Url(bytes));
  }

  return (
    <main className="appShell settingsShell">
      <div className="topBar">
        <div>
          <p className="eyebrow">Server configuration</p>
          <h1>Settings</h1>
        </div>
        <Link className="secondaryButton" href="/">
          <ArrowLeft size={16} aria-hidden="true" />
          Back to app
        </Link>
      </div>

      <section className="section settingsHero">
        <div>
          <Github size={28} aria-hidden="true" />
        </div>
        <div>
          <h2>GitHub connection</h2>
          <p>
            Connect with a personal access token or a GitHub OAuth app. Secrets are stored server-side and are not returned after saving.
          </p>
        </div>
        <div className={settings?.githubConfigured ? "readyPill" : "needsSetupPill"}>
          {settings?.githubConfigured ? <CheckCircle2 size={16} aria-hidden="true" /> : <KeyRound size={16} aria-hidden="true" />}
          {settings?.githubConfigured ? "Ready" : "Setup needed"}
        </div>
      </section>

      <section className="section">
        {loading ? (
          <div className="inlineState" role="status" aria-live="polite">
            <Loader2 className="spin" size={18} aria-hidden="true" />
            Loading settings
          </div>
        ) : (
          <div className="settingsForm">
            <div className="modeSelector" role="radiogroup" aria-label="GitHub connection mode" aria-describedby="mode-help">
              <button
                className={authMode === "token" ? "modeButton modeButtonActive" : "modeButton"}
                role="radio"
                aria-checked={authMode === "token"}
                type="button"
                onClick={() => setAuthMode("token")}
              >
                Personal access token
              </button>
              <button
                className={authMode === "oauth" ? "modeButton modeButtonActive" : "modeButton"}
                role="radio"
                aria-checked={authMode === "oauth"}
                type="button"
                onClick={() => setAuthMode("oauth")}
              >
                OAuth app
              </button>
            </div>
            <p className="fieldHint" id="mode-help">
              Token mode is simplest for personal repositories. OAuth mode requires a GitHub OAuth app client ID and secret.
            </p>

            <label>
              Application URL
              <input
                value={appUrl}
                onChange={(event) => setAppUrl(event.target.value)}
                placeholder="http://localhost:3000"
                type="url"
                autoComplete="url"
              />
            </label>

            {authMode === "token" ? (
              <label>
                GitHub personal access token
                <input
                  value={personalAccessToken}
                  onChange={(event) => setPersonalAccessToken(event.target.value)}
                  placeholder={settings?.hasPersonalAccessToken ? "Already configured" : "Paste token"}
                  type="password"
                  autoComplete="new-password"
                />
              </label>
            ) : (
              <>
                <label>
                  GitHub client ID
                  <input value={githubClientId} onChange={(event) => setGithubClientId(event.target.value)} autoComplete="off" />
                </label>

                <label>
                  GitHub client secret
                  <input
                    value={githubClientSecret}
                    onChange={(event) => setGithubClientSecret(event.target.value)}
                    placeholder={settings?.hasGithubClientSecret ? "Already configured" : "Paste client secret"}
                    type="password"
                    autoComplete="new-password"
                  />
                </label>

                <div className="secretRow">
                  <label>
                    Session secret
                    <input
                      value={sessionSecret}
                      onChange={(event) => setSessionSecret(event.target.value)}
                      placeholder={settings?.hasSessionSecret ? "Already configured" : "Generate or paste a long random secret"}
                      type="password"
                      autoComplete="new-password"
                    />
                  </label>
                  <button className="secondaryButton formButton" type="button" onClick={generateSessionSecret}>
                    <KeyRound size={16} aria-hidden="true" />
                    Generate
                  </button>
                </div>

                <label>
                  OAuth callback URL
                  <input value={callbackUrl} readOnly />
                </label>
              </>
            )}

            <div className="settingsMeta">
              <ShieldCheck size={16} aria-hidden="true" />
              {authMode === "token"
                ? "Use a fine-grained token for only the personal repositories this tool should access."
                : "Use this callback URL in your GitHub OAuth app settings."}
            </div>

            {settings && !settings.githubConfigured ? (
              <div className="softNotice">
                {authMode === "token" ? "Paste your GitHub token to connect." : "Complete the GitHub connection fields to enable sign-in."}
              </div>
            ) : null}

            {message ? <div className="successInline" role="status" aria-live="polite">{message}</div> : null}
            {error ? <div className="errorPanel" role="alert">{error}</div> : null}

            <div className="actionRow">
              <button className="primaryButton" type="button" onClick={saveSettings} disabled={saving} aria-busy={saving}>
                {saving ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
                Save settings
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}