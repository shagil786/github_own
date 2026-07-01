import { NextRequest, NextResponse } from "next/server";
import { guardPostRequest } from "@/lib/server/requestGuards";
import { clearSession } from "@/lib/server/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const guard = guardPostRequest(request, "auth:logout", { limit: 30 });
  if (guard) {
    return guard;
  }

  const response = NextResponse.json({ ok: true });
  clearSession(request, response);
  return response;
}