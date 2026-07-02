import { NextResponse } from "next/server";

export const runtime = "nodejs";

type TableStatus = "ready" | "missing" | "unknown";

type SupabaseCheckResult = {
  configured: boolean;
  urlConfigured: boolean;
  serverKeyConfigured: boolean;
  tables: {
    userSessions: TableStatus;
  };
  message: string;
};

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const configured = Boolean(supabaseUrl && serviceKey);

  const result: SupabaseCheckResult = {
    configured,
    urlConfigured: Boolean(supabaseUrl),
    serverKeyConfigured: Boolean(serviceKey),
    tables: {
      userSessions: "unknown"
    },
    message: configured
      ? "Supabase environment variables are configured."
      : "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY."
  };

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(result);
  }

  const restUrl = `${supabaseUrl.replace(/\/$/, "")}/rest/v1`;
  const userSessionsTable = safeTableName(process.env.SUPABASE_SESSION_TABLE) || "user_sessions";

  const userSessions = await checkTable(restUrl, serviceKey, userSessionsTable);

  result.tables.userSessions = userSessions;
  result.message = userSessions === "ready"
    ? "Supabase is ready for encrypted user sessions."
    : "Run the Supabase schema SQL to create the required user_sessions table.";

  return NextResponse.json(result);
}

async function checkTable(restUrl: string, serviceKey: string, table: string): Promise<TableStatus> {
  const url = new URL(`${restUrl}/${table}`);
  url.searchParams.set("select", "id");
  url.searchParams.set("limit", "1");

  try {
    const response = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`
      },
      cache: "no-store"
    });

    if (response.ok) {
      return "ready";
    }

    const data = await response.json().catch(() => null) as { message?: string } | null;
    if (data?.message?.includes("schema cache") || data?.message?.includes(table)) {
      return "missing";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

function safeTableName(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : null;
}
