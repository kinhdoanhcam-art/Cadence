// Contract views return JSON strings. Amounts stay decimal strings.
import type { Ledger, Req } from "./types.ts";

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    let value: unknown = JSON.parse(raw);
    if (typeof value === "string") value = JSON.parse(value);
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

const digits = (v: unknown) => typeof v === "string" && /^\d+$/.test(v);

export function parseLedger(raw: string): Ledger | null {
  const o = parseObject(raw);
  if (!o || typeof o.ledger_id !== "string" || !Array.isArray(o.approvers) || !digits(o.committed_unpaid) ||
      !digits(o.paid_total) || typeof o.today !== "number") return null;
  return o as unknown as Ledger;
}

export function parseRequest(raw: string): Req | null {
  const o = parseObject(raw);
  if (!o || typeof o.request_id !== "string" || !digits(o.amount) || !Array.isArray(o.schedule) ||
      !Array.isArray(o.approved_by) || typeof o.needed !== "number" || typeof o.state !== "string") return null;
  return o as unknown as Req;
}

export function parseRequestIds(raw: string): string[] | null {
  const o = parseObject(raw);
  if (!o || !Array.isArray(o.request_ids)) return null;
  return (o.request_ids as unknown[]).filter((x): x is string => typeof x === "string");
}

export type Limits = {
  rubric_hash?: string; contract_name?: string; version?: string; max_periods?: number; period_days?: number;
  max_approvers?: number; approvals_needed?: Record<string, number>;
};

export function parseLimits(raw: string): Limits | null {
  return parseObject(raw) as Limits | null;
}
