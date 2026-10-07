// Shapes of the contract's JSON views. Amounts are decimal strings.

export type Ledger = {
  ledger_id: string;
  owner: string;
  name: string;
  approvers: string[];
  approver_count: number;
  max_approvers: number;
  request_count: number;
  max_requests: number;
  pending_count: number;
  committed_unpaid: string;
  paid_total: string;
  today: number;
  today_date: string;
};

export type Period = { k: number; due_day: number; due_date: string; due: boolean; paid: boolean; paid_day: number | null };

export type Req = {
  request_id: string;
  ledger_id: string;
  requester: string;
  payee: string;
  amount: string;
  periods_asked: number;
  purpose: string;
  outcome: "RECURRING" | "ONE_OFF" | string;
  needed: number;
  approvals: number;
  approvals_left: number;
  approved_by: string[];
  state: "PENDING" | "APPROVED" | "COMPLETED" | "CANCELLED" | string;
  approved_day: number | null;
  approved_date: string | null;
  periods: number;
  periods_on_approval: number;
  period_days: number;
  paid_count: number;
  schedule: Period[];
  committed_unpaid: string;
  paid_total: string;
  today: number;
  today_date: string;
};

export type TxPhase = "idle" | "checking" | "signing" | "submitted" | "delayed" | "success" | "error";

export type TxStatus = { phase: TxPhase; message: string; hash?: string; action?: string };
