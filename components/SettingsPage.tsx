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
  runtimeSettingsAllowed: boolean;
  settingsAdminRequired: boolean;
  settingsAdminConfigured: boolean;
  hasSettingsAdminKey: boolean;
  settingsStorage: "supabase" | "redis" | "filesystem";
  supabaseSettingsConfigured: boolean;
  missing: string[];
  updatedAt?: string;
};

const PRODUCTION_RUNTIME_SETTINGS_HELP =
  "Runtime Settings writes are disabled on this deployment. To save a GitHub key from this page, set SETTINGS_ADMIN_KEY in Vercel and redeploy. Add Supabase service-role storage for durable saved settings.";

export function SettingsPage() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [authMode, setAuthMode] = useState<"token" | "oauth">("token");
  const [appUrl, setAppUrl] = useState("http://localhost:3000");
  const [githubClientId, setGithubClientId] = useState("");
  const [githubClientSecret, setGithubClientSecret] = useState("");
  const [personalAccessToken, setPersonalAccessToken] = useState("");
  const [sessionSecret, setSessionSecret] = useState("");
  const [settingsAdminKey, setSettingsAdminKey] = useState("");
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
    if (settings?.runtimeSettingsAllowed === false) {
      setMessage("");
      setError(PRODUCTION_RUNTIME_SETTINGS_HELP);
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/settings/github", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(settings?.settingsAdminRequired ? { "X-Settings-Admin-Key": settingsAdminKey.trim() } : {})
        },
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
      setSettingsAdminKey("");
      setMessage(authMode === "token" ? "Token saved. GitHub is connected." : "Settings saved. GitHub sign-in is ready.");
    } catch (saveError) {
      const nextError = saveError instanceof Error ? saveError.message : "Unable to save settings.";
      if (nextError.includes("Runtime settings are disabled in production")) {
        await loadSettings();
        setError(PRODUCTION_RUNTIME_SETTINGS_HELP);
      } else {
        setError(nextError);
      }
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
            {settings?.runtimeSettingsAllowed === false
              ? "Production uses environment variables. Secrets are read server-side and are never exposed to the browser."
              : "Connect with a personal access token or a GitHub OAuth app. Secrets are stored server-side and are not returned after saving."}
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
        ) : settings?.runtimeSettingsAllowed === false ? (
          <ProductionEnvironmentSettings settings={settings} callbackUrl={callbackUrl} />
        ) : (
          <div className="settingsForm">
            {settings?.settingsAdminRequired ? (
              <>
                <div className="settingsMeta">
                  <ShieldCheck size={16} aria-hidden="true" />
                  Enter the setup key from your deployment settings before saving changes.
                </div>
                <label>
                  Setup key
                  <input
                    value={settingsAdminKey}
                    onChange={(event) => setSettingsAdminKey(event.target.value)}
                    placeholder={settings.settingsAdminConfigured ? "Enter setup key" : "Setup key is missing in deployment"}
                    type="password"
                    autoComplete="new-password"
                    disabled={!settings.settingsAdminConfigured}
                  />
                </label>
              </>
            ) : null}

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
              {settings?.settingsStorage === "supabase"
                ? "Settings are encrypted and stored in Supabase."
                : settings?.settingsStorage === "redis"
                  ? "Settings are encrypted and stored in Redis/Upstash."
                  : authMode === "token"
                    ? "Use a fine-grained token for only the personal repositories this tool should access."
                    : "Use this callback URL in your GitHub OAuth app settings."}
            </div>

            {settings && !settings.githubConfigured ? (
              <p className="fieldHint">
                {authMode === "token" ? "Paste a token to connect your GitHub account." : "Complete the GitHub connection fields to enable sign-in."}
              </p>
            ) : null}

            {message ? <div className="successInline" role="status" aria-live="polite">{message}</div> : null}
            {error ? <div className="errorPanel" role="alert">{error}</div> : null}

            <div className="actionRow">
              <button
                className="primaryButton"
                type="button"
                onClick={saveSettings}
                disabled={
                  saving ||
                  Boolean(settings?.settingsAdminRequired && (!settings.settingsAdminConfigured || !settingsAdminKey.trim()))
                }
                aria-busy={saving}
              >
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

function ProductionEnvironmentSettings({ settings, callbackUrl }: { settings: PublicSettings; callbackUrl: string }) {
  return (
    <div className="settingsForm">
      <div className={settings.githubConfigured ? "successInline" : "softNotice"} role="status">
        {settings.githubConfigured
          ? "Production environment variables are configured."
          : "Add the setup key in your deployment settings, redeploy, then save your GitHub token here."}
      </div>

      <div className="envChecklist" aria-label="Runtime settings environment variables">
        <h2>Setup requirements</h2>
        <EnvVarRow name="Setup key" configured={settings.hasSettingsAdminKey} detail="Required once to unlock saving settings in production" />
        <EnvVarRow
          name="Secure storage"
          configured={settings.supabaseSettingsConfigured}
          detail="Supabase is recommended for saved Settings on production"
        />
      </div>

      <label>
        OAuth callback URL
        <input value={callbackUrl} readOnly />
      </label>

      {!settings.githubConfigured ? (
        <div className="errorPanel" role="alert">
          Missing: {settings.missing.length ? settings.missing.join(", ") : "GitHub environment variables"}.
        </div>
      ) : null}

      <div className="fieldHint">
        After updating Vercel environment variables, redeploy the project so the server picks them up.
      </div>
    </div>
  );
}

function EnvVarRow({ name, configured, detail }: { name: string; configured: boolean; detail: string }) {
  return (
    <div className="envVarRow">
      <div>
        <strong>{name}</strong>
        <span>{detail}</span>
      </div>
      <span className={configured ? "statusBadge statusBadge-commit" : "statusBadge statusBadge-blocked"}>
        {configured ? "Set" : "Missing"}
      </span>
    </div>
  );
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
