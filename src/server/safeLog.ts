/**
 * The only server logger for the Generate_Route / Provider_Status_Route
 * (Req 6A.11, 6A.12). It accepts and emits only route, status, code, task, ms;
 * any extra properties passed at runtime are dropped.
 */
import type { Task } from "@/core/generation";

export interface SafeLogEntry {
  route: string;
  status: number;
  code?: string;
  task?: Task;
  ms: number;
}

export function safeLog(entry: SafeLogEntry): void {
  const out: SafeLogEntry = {
    route: entry.route,
    status: entry.status,
    ms: entry.ms,
  };
  if (entry.code !== undefined) out.code = entry.code;
  if (entry.task !== undefined) out.task = entry.task;
  console.info(JSON.stringify(out));
}
