// get_ledger / get_request views as the contract returns them (day 20732 = 2026-10-06).
import type { Ledger, Period, Req } from "../../src/lib/types.ts";

export const A = "0x3065e31b1d993d7c0d59e6786844cba56780b2d3";
export const B = "0x5a52d040581a76e2c032542855d31480f2ea7097";
export const C = "0xade4533b5c00fc6c8e44f674213c081d919aad1d";
export const L = "02e9a35736f797df36e01f7bf36eda5e1f88f6eddfaacb0d1b802bca31026e3e";
export const R = "3a57ef38ee0062fdb4a391f5e90d653551bf58c46656f4666e7a6dadc2b82f8e";

export function ledger(over: Partial<Ledger> = {}): Ledger {
  return {
    ledger_id: L, owner: A, name: "Riverside makers club", approvers: [A, B, C], approver_count: 3, max_approvers: 5,
    request_count: 0, max_requests: 100, pending_count: 0, committed_unpaid: "0", paid_total: "0", today: 20732, today_date: "2026-10-06", ...over,
  };
}

export function sched(n: number, start = 20732, paid: number[] = []): Period[] {
  return Array.from({ length: n }, (_, k) => ({
    k, due_day: start + 30 * k, due_date: "", due: 20732 >= start + 30 * k, paid: paid.includes(k), paid_day: paid.includes(k) ? 20732 : null,
  }));
}

export function req(over: Partial<Req> = {}): Req {
  return {
    request_id: R, ledger_id: L, requester: C, payee: C, amount: "25000", periods_asked: 12, purpose: "Pays the designer to keep the logo current.",
    outcome: "RECURRING", needed: 2, approvals: 0, approvals_left: 2, approved_by: [], state: "PENDING", approved_day: null, approved_date: null,
    periods: 0, periods_on_approval: 12, period_days: 30, paid_count: 0, schedule: [], committed_unpaid: "0", paid_total: "0", today: 20732,
    today_date: "2026-10-06", ...over,
  };
}
