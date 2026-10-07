import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLedger, parseLimits, parseRequest, parseRequestIds } from "../../src/lib/parse.ts";
import { L, ledger, req, sched } from "./fixture.ts";

const LR = JSON.stringify(ledger({ committed_unpaid: "315000", paid_total: "25000", pending_count: 2 }));
const RR = JSON.stringify(req({ state: "APPROVED", periods: 12, schedule: sched(12) }));

test("views are parsed as JSON once, or twice when the RPC double-encodes them", () => {
  assert.equal(parseLedger(LR)?.committed_unpaid, "315000");
  assert.equal(parseLedger(JSON.stringify(LR))?.pending_count, 2);
  assert.equal(parseRequest(RR)?.schedule.length, 12);
  assert.deepEqual(parseRequestIds(JSON.stringify({ ledger_id: L, request_ids: ["a", "b"] })), ["a", "b"]);
  assert.equal(parseLimits('{"period_days": 30}')?.period_days, 30);
});

test("unknown id, broken JSON or a wrong shape read as nothing", () => {
  assert.equal(parseLedger("{}"), null);
  assert.equal(parseRequest("nope"), null);
  assert.equal(parseLedger(LR.replace('"committed_unpaid":"315000"', '"committed_unpaid":315000')), null);
  assert.equal(parseRequest(RR.replace('"amount":"25000"', '"amount":25000')), null);
  assert.equal(parseRequestIds("{}"), null);
});
