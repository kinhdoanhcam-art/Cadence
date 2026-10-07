// Postconditions checked AFTER the receipt says SUCCESS, against reloaded
// accepted state. A write is reported as done only when the state shows it.

import { pyStrip } from "./pytext.ts";
import type { Ledger, Req } from "./types.ts";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function openVerified(l: Ledger | null, s: { id: string; me: string; name: string }): boolean {
  return !!l && l.ledger_id === s.id && same(l.owner, s.me) && l.name === pyStrip(s.name) &&
    l.approvers.length === 1 && same(l.approvers[0], s.me) && l.request_count === 0;
}

export function addApproverVerified(before: Ledger, after: Ledger | null, wallet: string): boolean {
  return !!after && after.approver_count === before.approver_count + 1 && after.approvers.some((a) => same(a, pyStrip(wallet)));
}

export type RequestCheck = { ok: true; request: Req } | { ok: false };

/** The new request is mine, with my terms; RECURRING needs 2 approvals, ONE_OFF 1 (and one period on approval). */
export function requestVerified(r: Req | null, s: { id: string; me: string; payee: string; amount: string; periods: number; purpose: string }): RequestCheck {
  if (!r || r.request_id !== s.id || !same(r.requester, s.me) || !same(r.payee, pyStrip(s.payee)) ||
      r.amount !== s.amount || r.periods_asked !== s.periods || r.purpose !== pyStrip(s.purpose) ||
      r.state !== "PENDING" || r.approvals !== 0) return { ok: false };
  if (r.outcome === "RECURRING" && r.needed === 2 && r.periods_on_approval === s.periods) return { ok: true, request: r };
  if (r.outcome === "ONE_OFF" && r.needed === 1 && r.periods_on_approval === 1) return { ok: true, request: r };
  return { ok: false };
}

/** One more approval by me; reaching `needed` approves it with the periods the outcome allows, period k due approved_day + 30k. */
export function approveVerified(before: Req, after: Req | null, me: string): boolean {
  if (!after || after.approvals !== before.approvals + 1 || !after.approved_by.some((a) => same(a, me))) return false;
  if (after.approvals < after.needed) return after.state === "PENDING";
  if (after.state !== "APPROVED" || after.approved_day === null || after.periods !== before.periods_on_approval) return false;
  return after.schedule.length === after.periods &&
    after.schedule.every((p, k) => p.k === k && p.due_day === after.approved_day! + after.period_days * k && !p.paid);
}

export function markPaidVerified(before: Req, after: Req | null, k: number): boolean {
  if (!after || after.paid_count !== before.paid_count + 1 || !after.schedule[k]?.paid) return false;
  return after.paid_count >= after.periods ? after.state === "COMPLETED" : after.state === "APPROVED";
}

export function cancelVerified(after: Req | null): boolean {
  return !!after && after.state === "CANCELLED" && after.committed_unpaid === "0";
}
