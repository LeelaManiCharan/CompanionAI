/**
 * zod schema for Generate_Route request bodies (Req 6A.3, 6A.4).
 */
import { z } from "zod";

export const GenerateRequestSchema = z
  .object({
    task: z.enum(["reply", "extract_memories", "summarize", "test"]),
    system: z.string().min(1).max(20_000),
    messages: z
      .array(
        z
          .object({
            role: z.enum(["user", "companion"]),
            content: z.string().min(1).max(10_000),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

export type GenerateRequestBody = z.infer<typeof GenerateRequestSchema>;

/** Failing field names (issue paths joined with ".") for a 400 response. */
export function issueFields(error: z.ZodError): string[] {
  const fields = new Set<string>();
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      const prefix = issue.path.join(".");
      for (const k of issue.keys) fields.add(prefix ? `${prefix}.${k}` : k);
    } else {
      fields.add(issue.path.length ? issue.path.join(".") : "(root)");
    }
  }
  return [...fields];
}
