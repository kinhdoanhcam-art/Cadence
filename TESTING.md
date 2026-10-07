# TESTING

```
COMPILE PASS ≠ RUNTIME PASS
SUBMITTED ≠ ACCEPTED ≠ FINALIZED ≠ EXECUTION SUCCESS ≠ POSTCONDITION PASS
```

## Automated gates (run before release; CI runs them on every push)

| Gate | Command | Result |
|---|---|---|
| Kill-set + rubric gate | `python3 RECURS_KILLSET_CHECK.py contracts/Recurs.py` | rc 0 — no word or word pair separates the classes; the rubric shares no content word with any case |
| genvm-linter | `python3 -m genvm_linter.cli lint contracts/Recurs.py` | pass |
| Contract tests (Direct Mode: the real py-genlayer v0.2.16 SDK, model mocked) | `python3 -m pytest tests/contract -q -p no:cacheprovider` | 76 passed |
| Mutation check | `python3 tools/mutate.py .` | 29/29 deliberate faults caught |
| Frontend build | `npm run build` | rc 0 |
| Frontend tests | `npm test` | 49 passed |
| Source hash | `npm run verify:source` | `contracts/Recurs.py` matches `SOURCE_SHA256.txt` |
| Calldata table | `node tools/calldata-bytes.mjs` | every write ≤ 255 bytes (largest: `request` at every cap, 247) |
| Calldata on the RPC | `node tools/probe-calldata.mjs <address>` | runs in CI against both addresses in `deployments.json` |

The mocked model labels drive the deterministic code paths; they say nothing about what the real model returns. The
on-chain runs do.

### What the mutation check catches

Each fault is applied to the contract alone and the suite must go red (`tests/mutations.py`): RECURRING needing only
one approval, ONE_OFF keeping the declared periods, a RECURRING schedule collapsing to one period, the approval
threshold off by one, the period length ignored, the due check off by one, the approval day not recorded, the fail-safe
flipped, an unknown label read as RECURRING, the validator accepting any label, anyone allowed to approve, the requester
approving their own request, one approver counted twice, anyone marking payments, a period paid twice, completion not
reached, anyone cancelling, a cancelled request still counted as committed, anyone adding approvers, the approver cap off
by one, the same request filed twice, the request id ignoring whitespace, the reserved-token check dropped, the purpose
and request caps off by one, a single-pass fence, a wallet leaking into the prompt, the caller checked before the state
in approve, and the day helper ignoring the day of the month.

### Calldata

Encoded exactly as genlayer-js 1.1.8 `writeContract` does. The ten case purposes measure 174–198 bytes with amount 25000
and 12 periods; `request` at the maximum amount, 12 periods and a 100-character purpose measures 247. A purpose of
non-ASCII letters takes more bytes per character, so the request form shows a byte meter and disables *Send request*
above 255 bytes.

## Frontend checks

- **Revert sentences** (`tests/js/rules.test.ts`): the set in `src/lib/rules.ts` equals the 28 sentences in the source,
  and for every write the UI reports the earliest failing check in the source's order — the approver check before the
  own-request rule, as in row 5 of the on-chain run.
- **Ids and dates** (`tests/js/ids.test.ts`): ledger and request ids, and day numbers turned into dates, equal to vectors
  produced by the contract on the real SDK (whitespace, Unicode, leap days, before 1970) and to the on-chain run.
- **Postconditions** (`tests/js/verify.test.ts`): a request is reported only when its reading and its approvals needed
  agree (RECURRING 2 with the declared periods, ONE_OFF 1 with one period); an approval only when the reloaded schedule
  has period k due on approval day + 30 × k.
- **Receipts** (`tests/js/receipt.test.ts`): a leader SUCCESS while validators are still proposing, committing or
  revealing is pending, not success.
- **Interface check** (Playwright against `vite preview`, the RPC mocked by decoding calldata): overview, a ledger seen by
  the owner, the requester and a second approver (Approve, Mark paid and Cancel enabled or disabled with the contract's
  sentence), typing a purpose key by key, the new-ledger form with an existing name, and 390 px — no page error, no
  horizontal scroll.

## On-chain runs

See `RUNTIME_EVIDENCE.md`: the Project run through this app (10 transactions) and the Intelligent Contract run (13
transactions, every must-verify row PASS), one hash per row.

Project run through the app: "Pays the designer to keep the logo current." was read **RECURRING** (2 approvals, 12
periods) and "Pays the designer for the logo." **ONE_OFF** (1 approval, one period although 12 were declared); the
requester's *Approve* was disabled with the contract's sentence; two approvals produced 12 periods 30 days apart; the
one-off was paid and completed, period 0 of the recurring request was paid and period 1 was refused as not yet due;
the ledger read 275,000 committed and unpaid and 65,000 paid. Every result was reported only after the app re-read the
state: **PASS**.

Intelligent Contract run: R1 → RECURRING (needs 2) and O1 → ONE_OFF (needs 1, one period although 12 were declared); R2
→ RECURRING and O2 → ONE_OFF; two approvals turned R1 into 12 periods with period 0 due that day and period 1 thirty days
later; the requester's own approval, the early payment and the totals all matched: **PASS**.

## Consensus behaviour

The model is called once per request. Validators re-run the reading and must agree on the exact label; a disagreement
rotates the leader or ends the transaction without recording the request. Every other write is deterministic.

## What this run does NOT prove

- Each case is sent once; label stability across repeated runs or validator sets is not measured.
- Periods after the first are not reached on-chain (they need 30 days); the schedule arithmetic is covered offline with
  a moved clock.
- Prompt-injection resistance rests on the fence and the reserved-token check; no adversarial model run is done.
