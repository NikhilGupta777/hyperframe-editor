import type { Request, Response } from "express";
import { z } from "zod";

export function badRequest(res: Response, message: string, extra?: unknown) {
  return res.status(400).json({ error: message, details: extra });
}

export function notFound(res: Response, what = "resource") {
  return res.status(404).json({ error: `${what} not found` });
}

export function serverError(res: Response, e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  return res.status(500).json({ error: message });
}

export async function readJson<T>(
  req: Request,
  res: Response,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, "invalid body", parsed.error.format());
    return null;
  }
  return parsed.data;
}

export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";
