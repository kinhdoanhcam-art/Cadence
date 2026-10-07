// Shared rows for tools/calldata-bytes.mjs, tools/probe-calldata.mjs and tests.
export const ID = "f".repeat(64);
export const WALLET = "0x" + "1".repeat(40);

// Every purpose of the test cases (each pair shares its surface).
export const CASES = {
  R1: "Pays the designer to keep the logo current.",
  R2: "Covers the server that hosts our site.",
  R3: "Keeps our seat on the regional river-cleanup board.",
  R4: "Pays the cleaner who does the hall after each meetup.",
  R5: "Our share of the shared office internet.",
  O1: "Pays the designer for the logo.",
  O2: "Covers the server we bought for the site.",
  O3: "Pays the entry fee for the regional river-cleanup race.",
  O4: "Pays the cleaner for the hall after the launch party.",
  O5: "Our share of the office internet installation.",
};

/** HARD BLOCK: any of these over 255 bytes stops the release. */
export function hardBlockRows() {
  const rows = Object.entries(CASES).map(([name, text]) => ({ name: `request ${name}`, method: "request", args: [ID, WALLET, 25000, 12, text] }));
  rows.push({ name: "request (max amount, 12 periods, 100-character purpose)", method: "request", args: [ID, WALLET, 10n ** 12n, 12, "p".repeat(100)] });
  rows.push({ name: "open_ledger (60-character name)", method: "open_ledger", args: ["n".repeat(60)] });
  rows.push({ name: "add_approver (id, wallet)", method: "add_approver", args: [ID, WALLET] });
  rows.push({ name: "approve (id)", method: "approve", args: [ID] });
  rows.push({ name: "mark_paid (id, 11)", method: "mark_paid", args: [ID, 11] });
  rows.push({ name: "cancel (id)", method: "cancel", args: [ID] });
  return rows;
}

/** MEASURE ONLY: non-ASCII purposes take more bytes per character. */
export function measureOnlyRows() {
  return [{ name: "request with a 100-character purpose of 2-byte letters", method: "request", args: [ID, WALLET, 10n ** 12n, 12, "é".repeat(100)] }];
}
