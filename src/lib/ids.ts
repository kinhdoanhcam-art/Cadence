import { keccak256, stringToBytes } from "viem";
import { pyLen, pyNormalize, pyStrip } from "./pytext.ts";

// Keccak-256 (Ethereum), not NIST SHA3-256. Same payloads as the contract:
//   ledger  = keccak256("RECURS:LEDGER:V1|" + owner_lower + "|" + len(n) + "|" + n)
//   request = keccak256("RECURS:REQUEST:V1|" + ledger_id + "|" + requester_lower + "|" + len(p) + "|" + p)
// where n and p are the name and the purpose, Python-stripped with whitespace collapsed.
export function ledgerIdOf(owner: string, name: string): string {
  const n = pyNormalize(pyStrip(name));
  return keccak256(stringToBytes("RECURS:LEDGER:V1|" + owner.toLowerCase() + "|" + pyLen(n) + "|" + n)).slice(2);
}

export function requestIdOf(ledgerId: string, requester: string, purpose: string): string {
  const p = pyNormalize(pyStrip(purpose));
  return keccak256(stringToBytes("RECURS:REQUEST:V1|" + ledgerId.toLowerCase() + "|" + requester.toLowerCase() + "|" + pyLen(p) + "|" + p)).slice(2);
}

/** The contract's _day_to_date: days since 1970-01-01 -> "YYYY-MM-DD" (proleptic Gregorian, integer arithmetic). */
export function dayToDate(day: number): string {
  const z = day + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  let y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  if (m <= 2) y += 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Every 64-hex id found in a bare id, a 0x id, a link or a comma list. */
export function idsFromInput(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(/(?<![0-9a-fA-F])([0-9a-fA-F]{64})(?![0-9a-fA-F])/g)) {
    const id = m[1].toLowerCase();
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function short(value: string, head = 6, tail = 4): string {
  if (!value || value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** 315000 -> "315,000" (amounts are whole numbers in the ledger's smallest unit). */
export function fmtAmount(value: string | number): string {
  const s = String(value);
  return /^\d+$/.test(s) ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : s;
}
