import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dayToDate, fmtAmount, idsFromInput, ledgerIdOf, requestIdOf } from "../../src/lib/ids.ts";

const v = JSON.parse(readFileSync(new URL("./id-vectors.json", import.meta.url), "utf8"));

test("ledger ids match the contract, including whitespace and Unicode", () => {
  assert.ok(v.ledgers.length >= 5);
  for (const row of v.ledgers) assert.equal(ledgerIdOf(v.owner, row.name), row.ledger_id, JSON.stringify(row.name));
});

test("request ids match the contract", () => {
  const lid = v.ledgers[0].ledger_id;
  for (const row of v.requests) {
    assert.equal(requestIdOf(lid, v.requester, row.purpose), row.request_id, JSON.stringify(row.purpose));
    assert.equal(requestIdOf(lid.toUpperCase(), v.requester.toLowerCase(), row.purpose), row.request_id);
  }
});

test("day numbers become the contract's dates (leap days, year ends, before 1970)", () => {
  for (const row of v.dates) assert.equal(dayToDate(row.day), row.date, String(row.day));
});

test("the ledger and request of the on-chain run are reproduced", () => {
  const A = "0x3065E31B1D993d7C0D59E6786844cBa56780B2d3", C = "0x579265b5718049eC4D07EED310C86E308B6d9AE1";
  const L = ledgerIdOf(A, "Riverside makers club");
  assert.equal(L, "02e9a35736f797df36e01f7bf36eda5e1f88f6eddfaacb0d1b802bca31026e3e");
  assert.equal(requestIdOf(L, C, "Pays the designer to keep the logo current."), "3a57ef38ee0062fdb4a391f5e90d653551bf58c46656f4666e7a6dadc2b82f8e");
});

test("ids from links, amounts with separators", () => {
  const a = "02e9a35736f797df36e01f7bf36eda5e1f88f6eddfaacb0d1b802bca31026e3e";
  assert.deepEqual(idsFromInput(`https://x.app/?l=${a}`), [a]);
  assert.deepEqual(idsFromInput(a + "ab"), []);
  assert.equal(fmtAmount("315000"), "315,000");
  assert.equal(fmtAmount("1000000000000"), "1,000,000,000,000");
  assert.equal(fmtAmount(7), "7");
});
