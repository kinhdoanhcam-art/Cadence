// Postconditions: a write is reported as done only when the reloaded state shows it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addApproverVerified, approveVerified, cancelVerified, markPaidVerified, openVerified, requestVerified } from "../../src/lib/verify.ts";
import { A, B, C, L, ledger, R, req, sched } from "./fixture.ts";

test("open and add approver", () => {
  const s = { id: L, me: A, name: "  Riverside makers club " };
  assert.ok(openVerified(ledger({ approvers: [A], approver_count: 1 }), s));
  assert.ok(!openVerified(ledger(), s));
  assert.ok(addApproverVerified(ledger({ approvers: [A], approver_count: 1 }), ledger({ approvers: [A, B], approver_count: 2 }), B));
  assert.ok(!addApproverVerified(ledger({ approvers: [A], approver_count: 1 }), ledger({ approvers: [A], approver_count: 1 }), B));
});

test("request: RECURRING needs 2 and keeps 12 periods; ONE_OFF needs 1 and is one period", () => {
  const s = { id: R, me: C, payee: C, amount: "25000", periods: 12, purpose: "Pays the designer to keep the logo current." };
  assert.equal(requestVerified(req(), s).ok, true);
  assert.equal(requestVerified(req({ outcome: "ONE_OFF", needed: 1, periods_on_approval: 1 }), s).ok, true);
  assert.equal(requestVerified(req({ outcome: "ONE_OFF", needed: 2, periods_on_approval: 1 }), s).ok, false);
  assert.equal(requestVerified(req({ amount: "2500" }), s).ok, false);
  assert.equal(requestVerified(null, s).ok, false);
});

test("approve: first approval keeps it pending; the second makes 12 periods 30 days apart", () => {
  const one = req({ approvals: 1, approvals_left: 1, approved_by: [A] });
  assert.ok(approveVerified(req(), one, A));
  const done = req({ approvals: 2, approved_by: [A, B], state: "APPROVED", approved_day: 20732, periods: 12, schedule: sched(12) });
  assert.ok(approveVerified(one, done, B));
  assert.ok(!approveVerified(one, { ...done, periods: 1, schedule: sched(1) }, B));
  assert.ok(!approveVerified(one, { ...done, schedule: sched(12, 20733) }, B));
  const oneOff = req({ outcome: "ONE_OFF", needed: 1, periods_on_approval: 1 });
  assert.ok(approveVerified(oneOff, { ...oneOff, approvals: 1, approved_by: [A], state: "APPROVED", approved_day: 20732, periods: 1, schedule: sched(1) }, A));
});

test("mark paid and cancel", () => {
  const r = req({ state: "APPROVED", approved_day: 20732, periods: 12, schedule: sched(12) });
  assert.ok(markPaidVerified(r, { ...r, paid_count: 1, schedule: sched(12, 20732, [0]) }, 0));
  assert.ok(!markPaidVerified(r, r, 0));
  const one = { ...r, periods: 1, schedule: sched(1) };
  assert.ok(markPaidVerified(one, { ...one, paid_count: 1, state: "COMPLETED", schedule: sched(1, 20732, [0]) }, 0));
  assert.ok(cancelVerified(req({ state: "CANCELLED" })));
  assert.ok(!cancelVerified(req()));
});
