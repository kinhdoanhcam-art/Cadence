// Every predictable revert, in the contract's own order, with its exact sentence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addApproverBlock, approveBlock, cancelBlock, markPaidBlock, nextPayable, openBlock, parseWhole, RESERVED_TOKENS, REVERTS, requestBlock,
  stateLine, UI,
} from "../../src/lib/rules.ts";
import { A, B, C, ledger, req, sched } from "./fixture.ts";

const contract = readFileSync(new URL("../../contracts/Recurs.py", import.meta.url), "utf8");

test("every revert sentence is the contract's own, and every contract revert is mirrored", () => {
  const inContract = [...contract.matchAll(/UserError\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(Object.values(REVERTS))].sort(), [...new Set(inContract)].sort());
});

test("reserved tokens equal the contract's", () => {
  for (const t of RESERVED_TOKENS) assert.ok(contract.includes(`"${t}"`), t);
});

test("open_ledger: name, then not opened before", () => {
  assert.equal(openBlock(A, "Riverside makers club", false), null);
  assert.equal(openBlock("", "x", false), UI.noWallet);
  assert.equal(openBlock(A, " 　 ", false), REVERTS.nameEmpty);
  assert.equal(openBlock(A, "n".repeat(61), false), REVERTS.nameTooLong);
  assert.equal(openBlock(A, "x", true), REVERTS.ledgerExists);
});

test("add_approver: owner -> wallet -> not already -> under five", () => {
  const l = ledger({ approvers: [A], approver_count: 1 });
  assert.equal(addApproverBlock(l, A, B), null);
  assert.equal(addApproverBlock(l, B, C), REVERTS.onlyOwnerAdd);
  assert.equal(addApproverBlock(l, A, "0x123"), REVERTS.invalidWallet);
  assert.equal(addApproverBlock(l, A, "0x" + "0".repeat(40)), REVERTS.invalidWallet);
  assert.equal(addApproverBlock(l, A, A.toUpperCase().replace("0X", "0x")), REVERTS.alreadyApprover);
  assert.equal(addApproverBlock(ledger({ approver_count: 5, approvers: [A, B, C, "0x" + "4".repeat(40), "0x" + "5".repeat(40)] }), A, "0x" + "6".repeat(40)), REVERTS.maxApprovers);
});

test("request: payee -> amount -> periods -> purpose -> reserved -> full -> exists -> bytes", () => {
  const ok = { me: C, ledger: ledger(), payee: C, amount: "25000", periods: "12", purpose: "Pays the designer for the logo.", exists: false, bytes: 174 };
  assert.equal(requestBlock(ok), null);
  assert.equal(requestBlock({ ...ok, ledger: null }), UI.noLedger);
  assert.equal(requestBlock({ ...ok, payee: "0xabc" }), REVERTS.invalidPayee);
  assert.equal(requestBlock({ ...ok, amount: "0" }), REVERTS.amountRange);
  assert.equal(requestBlock({ ...ok, amount: "1000000000001" }), REVERTS.amountRange);
  assert.equal(requestBlock({ ...ok, amount: "1,000,000,000,000" }), null);
  assert.equal(requestBlock({ ...ok, amount: "2.5" }), REVERTS.amountRange);
  assert.equal(requestBlock({ ...ok, periods: "13" }), REVERTS.periodsRange);
  assert.equal(requestBlock({ ...ok, periods: "0" }), REVERTS.periodsRange);
  assert.equal(requestBlock({ ...ok, purpose: "  " }), REVERTS.purposeEmpty);
  assert.equal(requestBlock({ ...ok, purpose: "p".repeat(101) }), REVERTS.purposeTooLong);
  assert.equal(requestBlock({ ...ok, purpose: "a one_off fee" }), REVERTS.reserved);
  assert.equal(requestBlock({ ...ok, ledger: ledger({ request_count: 100 }) }), REVERTS.ledgerFull);
  assert.equal(requestBlock({ ...ok, exists: true }), REVERTS.requestExists);
  assert.equal(requestBlock({ ...ok, bytes: 256 }), UI.tooManyBytes);
});

test("approve: pending -> approver -> not the requester (the on-chain row 5) -> not twice", () => {
  assert.equal(approveBlock(req(), ledger(), A), null);
  assert.equal(approveBlock(req(), ledger(), C), REVERTS.ownRequest);
  assert.equal(approveBlock(req(), ledger({ approvers: [A, B] }), C), REVERTS.onlyApprover, "approver check comes first");
  assert.equal(approveBlock(req({ approved_by: [A], approvals: 1 }), ledger(), A), REVERTS.alreadyApproved);
  assert.equal(approveBlock(req({ state: "APPROVED" }), ledger(), A), REVERTS.notPending);
});

test("mark_paid: approved -> owner -> period -> due (period 1 is 30 days out) -> not paid", () => {
  const r = req({ state: "APPROVED", periods: 12, approved_day: 20732, schedule: sched(12) });
  assert.equal(markPaidBlock(r, ledger(), A, 0), null);
  assert.equal(markPaidBlock(r, ledger(), A, 1), REVERTS.notDue);
  assert.equal(markPaidBlock(r, ledger(), B, 0), REVERTS.onlyOwnerPay);
  assert.equal(markPaidBlock(r, ledger(), A, 12), REVERTS.unknownPeriod);
  assert.equal(markPaidBlock({ ...r, schedule: sched(12, 20732, [0]) }, ledger(), A, 0), REVERTS.alreadyPaid);
  assert.equal(markPaidBlock(req(), ledger(), A, 0), REVERTS.notApproved);
  assert.equal(nextPayable(r), 0);
  assert.equal(nextPayable({ ...r, schedule: sched(12, 20732, [0]) }), -1);
});

test("cancel: open -> requester or owner", () => {
  assert.equal(cancelBlock(req(), ledger(), C), null);
  assert.equal(cancelBlock(req(), ledger(), A), null);
  assert.equal(cancelBlock(req(), ledger(), B), REVERTS.onlyCancel);
  assert.equal(cancelBlock(req({ state: "COMPLETED" }), ledger(), A), REVERTS.closed);
});

test("whole numbers and state lines", () => {
  assert.equal(parseWhole("25_000"), 25000n);
  assert.equal(parseWhole("-1"), null);
  assert.equal(stateLine(req({ approvals: 1, approvals_left: 1 })), "1 of 2 approvals · 1 to go");
  assert.equal(stateLine(req({ state: "APPROVED", periods: 12, paid_count: 1 })), "1 of 12 periods paid");
});
