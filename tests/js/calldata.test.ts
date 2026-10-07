// Calldata size of every write method, encoded exactly as genlayer-js 1.1.8 does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calldataBytes, CALLDATA_LIMIT } from "../../src/lib/calldata.ts";
import { CASES, hardBlockRows, ID, WALLET } from "../../tools/calldata-rows.mjs";

test("ten case purposes + every write at its cap stay under 255 bytes", () => {
  assert.equal(Object.keys(CASES).length, 10);
  for (const row of hardBlockRows()) {
    const n = calldataBytes(row.method, row.args);
    assert.ok(n <= CALLDATA_LIMIT, `${row.name}: ${n} bytes`);
  }
});

test("a 100-character ASCII purpose at the max amount fits (247 bytes); non-ASCII can pass the cliff", () => {
  assert.equal(calldataBytes("request", [ID, WALLET, 10n ** 12n, 12, "p".repeat(100)]), 247);
  assert.ok(calldataBytes("request", [ID, WALLET, 10n ** 12n, 12, "é".repeat(100)]) > CALLDATA_LIMIT);
});
