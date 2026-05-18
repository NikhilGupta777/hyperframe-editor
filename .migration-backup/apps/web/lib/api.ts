/**
 * Shared API helpers used by route handlers. We keep the route files thin and
 * push parsing/validation/storage glue here so the same logic is reachable from
 * server actions and webhook handlers later.
 */
import { z } from "zod";
import { NextResponse } from "next/server";

export function badRequest(message: string, extra?: unknown) {
  return NextResponse.json({ error: message, details: extra }, { status: 400 });
}
export function notFound(what = "resource") {
  return NextResponse.json({ error: `${what} not found` }, { status: 404 });
}
export function serverError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  console.error("[api]", message);
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Parse JSON body and validate; returns either the value or a NextResponse 400. */
export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T | NextResponse> {
  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return badRequest("invalid body", parsed.error.format());
  return parsed.data;
}

/**
 * Demo user id. Phase 4 swaps this for a real auth principal (Resend magic-link
 * or Clerk). For now we keep one fixed UUID per browser via a cookie so the
 * editor works without sign-up flow.
 */
export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";
