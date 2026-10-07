// Mirrors every revert of contracts/Recurs.py that can be predicted from state
// already read, in the SAME order the contract checks them. Whether a purpose is
// ongoing or one-time is NEVER decided here: only validators decide that, inside
// request(). The outcome is read back from the view.

import { pyContainsToken, pyLen, pyStrip } from "./pytext.ts";
import type { Ledger, Req } from "./types.ts";

export const MAX_LEDGER_NAME_LENGTH = 60;
export const MAX_APPROVERS = 5;
export const MAX_PURPOSE_LENGTH = 100;
export const MAX_AMOUNT = 10n ** 12n;
export const MAX_PERIODS = 12;
export const PERIOD_DAYS = 30;
export const MAX_REQUESTS_PER_LEDGER = 100;
export const APPROVALS = { RECURRING: 2, ONE_OFF: 1 } as const;

export const RESERVED_TOKENS = ["<UNTRUSTED_PURPOSE>", "</UNTRUSTED_PURPOSE>", "RECURRING", "ONE_OFF"] as const;

export const REVERTS = {
  nameEmpty: "Ledger name is empty",
  nameTooLong: "Ledger name is too long",
  ledgerExists: "This ledger already exists",
  unknownLedger: "Unknown ledger id",
  onlyOwnerAdd: "Only the ledger owner may add approvers",
  invalidWallet: "Invalid wallet address",
  alreadyApprover: "This wallet is already an approver",
  maxApprovers: "This ledger has the maximum number of approvers",
  invalidPayee: "Invalid payee address",
  amountRange: "Amount is out of range",
  periodsRange: "Periods must be between 1 and 12",
  purposeEmpty: "Purpose is empty",
  purposeTooLong: "Purpose is too long",
  reserved: "Text contains a reserved token",
  ledgerFull: "This ledger is full",
  requestExists: "This request already exists",
  unknownRequest: "Unknown request id",
  notPending: "This request is not pending",
  onlyApprover: "Only an approver may approve",
  ownRequest: "You cannot approve your own request",
  alreadyApproved: "You have already approved this request",
  notApproved: "This request is not approved",
  onlyOwnerPay: "Only the ledger owner may mark payments",
  unknownPeriod: "Unknown period",
  notDue: "This period is not due yet",
  alreadyPaid: "This period is already paid",
  closed: "This request is already closed",
  onlyCancel: "Only the requester or the ledger owner may cancel",
} as const;

/** UI-only reasons (the contract never sees these calls). */
export const UI = {
  noWallet: "Connect a wallet first",
  noLedger: "Open a ledger first",
  tooManyBytes: "This text is over the 255-byte calldata limit; shorten it",
} as const;

const ZERO = "0x0000000000000000000000000000000000000000";
const same = (a: string, b: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** The contract's wallet check: 0x + 40 lower-case hex after strip/lower. */
export function walletOrEmpty(value: string): string {
  const w = pyStrip(value).toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(w) ? w : "";
}

/** Whole numbers only; "" when not a plain non-negative integer. */
export function parseWhole(value: string): bigint | null {
  const s = value.trim().replace(/[,_\s]/g, "");
  return /^\d+$/.test(s) ? BigInt(s) : null;
}

export function isApprover(l: Ledger, wallet: string): boolean {
  return l.approvers.some((a) => same(a, wallet));
}

/** open_ledger order: name 1–60 -> not opened before. */
export function openBlock(me: string, name: string, exists: boolean): string | null {
  if (!me) return UI.noWallet;
  const n = pyStrip(name);
  if (pyLen(n) === 0) return REVERTS.nameEmpty;
  if (pyLen(n) > MAX_LEDGER_NAME_LENGTH) return REVERTS.nameTooLong;
  if (exists) return REVERTS.ledgerExists;
  return null;
}

/** add_approver order: owner -> valid wallet -> not already -> under 5. */
export function addApproverBlock(l: Ledger, me: string, wallet: string): string | null {
  if (!me) return UI.noWallet;
  if (!same(l.owner, me)) return REVERTS.onlyOwnerAdd;
  const w = walletOrEmpty(wallet);
  if (!w || w === ZERO) return REVERTS.invalidWallet;
  if (isApprover(l, w)) return REVERTS.alreadyApprover;
  if (l.approver_count >= MAX_APPROVERS) return REVERTS.maxApprovers;
  return null;
}

export type RequestInput = {
  me: string; ledger: Ledger | null; payee: string; amount: string; periods: string; purpose: string; exists: boolean; bytes: number;
};

/** request order: ledger -> payee -> amount -> periods -> purpose -> reserved -> ledger full -> not requested before. */
export function requestBlock(i: RequestInput): string | null {
  if (!i.me) return UI.noWallet;
  if (!i.ledger) return UI.noLedger;
  const p = walletOrEmpty(i.payee);
  if (!p || p === ZERO) return REVERTS.invalidPayee;
  const a = parseWhole(i.amount);
  if (a === null || a < 1n || a > MAX_AMOUNT) return REVERTS.amountRange;
  const n = parseWhole(i.periods);
  if (n === null || n < 1n || n > BigInt(MAX_PERIODS)) return REVERTS.periodsRange;
  const t = pyStrip(i.purpose);
  if (pyLen(t) === 0) return REVERTS.purposeEmpty;
  if (pyLen(t) > MAX_PURPOSE_LENGTH) return REVERTS.purposeTooLong;
  if (pyContainsToken(t, RESERVED_TOKENS)) return REVERTS.reserved;
  if (i.ledger.request_count >= MAX_REQUESTS_PER_LEDGER) return REVERTS.ledgerFull;
  if (i.exists) return REVERTS.requestExists;
  if (i.bytes > 255) return UI.tooManyBytes;
  return null;
}

/** approve order: PENDING -> approver of the ledger -> not the requester -> not approved before. */
export function approveBlock(r: Req, l: Ledger | null, me: string): string | null {
  if (!me) return UI.noWallet;
  if (r.state !== "PENDING") return REVERTS.notPending;
  if (!l || !isApprover(l, me)) return REVERTS.onlyApprover;
  if (same(r.requester, me)) return REVERTS.ownRequest;
  if (r.approved_by.some((a) => same(a, me))) return REVERTS.alreadyApproved;
  return null;
}

/** mark_paid order: APPROVED -> ledger owner -> period exists -> due -> not paid. */
export function markPaidBlock(r: Req, l: Ledger | null, me: string, k: number): string | null {
  if (!me) return UI.noWallet;
  if (r.state !== "APPROVED") return REVERTS.notApproved;
  if (!l || !same(l.owner, me)) return REVERTS.onlyOwnerPay;
  if (k < 0 || k >= r.periods) return REVERTS.unknownPeriod;
  const p = r.schedule[k];
  if (!p || r.today < p.due_day) return REVERTS.notDue;
  if (p.paid) return REVERTS.alreadyPaid;
  return null;
}

/** cancel order: PENDING or APPROVED -> requester or ledger owner. */
export function cancelBlock(r: Req, l: Ledger | null, me: string): string | null {
  if (!me) return UI.noWallet;
  if (r.state !== "PENDING" && r.state !== "APPROVED") return REVERTS.closed;
  if (!same(r.requester, me) && !(l && same(l.owner, me))) return REVERTS.onlyCancel;
  return null;
}

/** The next period the owner can mark paid, or -1. */
export function nextPayable(r: Req): number {
  if (r.state !== "APPROVED") return -1;
  const p = r.schedule.find((s) => !s.paid && s.due_day <= r.today);
  return p ? p.k : -1;
}

export function stateLine(r: Req): string {
  if (r.state === "PENDING") return `${r.approvals} of ${r.needed} approval${r.needed === 1 ? "" : "s"} · ${r.approvals_left} to go`;
  if (r.state === "APPROVED") return `${r.paid_count} of ${r.periods} period${r.periods === 1 ? "" : "s"} paid`;
  if (r.state === "COMPLETED") return `All ${r.periods} period${r.periods === 1 ? "" : "s"} paid`;
  return "Cancelled — unpaid periods stopped";
}
