import type { NextRequest } from "next/server";
import { getEffectiveGithubSettings, missingGithubSettings } from "@/lib/server/appSettings";

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function missingGithubAuthEnv(): Promise<string[]> {
  return missingGithubSettings();
}

export function optionalNumberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function appBaseUrl(request: NextRequest): Promise<string> {
  const configured = (await getEffectiveGithubSettings()).appUrl;
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
