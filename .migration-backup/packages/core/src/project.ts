import { z } from "zod";

export const ProjectStatusSchema = z.enum(["draft", "building", "ready", "rendered", "archived"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string(),
  preset: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive().default(30),
  durationSec: z.number().nonnegative().default(0),
  storageUri: z.string(),
  budgetUsd: z.number().nonnegative().default(1.0),
  status: ProjectStatusSchema.default("draft"),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;
