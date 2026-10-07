# Changelog

## 1.0.0 — 2026-10-07

- Contract `Recurs` (frozen, SHA-256 `e16d5c3f…92fa1`) deployed for this Project at
  `0x95F3EDaaa83bf9BD16ded36528c9C8312329CB94` (StudioNet). The Intelligent Contract submission is a separate deployment
  of the same source.
- App: overview; a ledger view with totals, approvers and request cards (reading, signatures, schedule, Approve / Mark
  paid / Cancel); a request form showing the request id before signing; a verification page reading `get_limits`.
- Run through the app on StudioNet (10 transactions, `RUNTIME_EVIDENCE.md`): the same designer and logo read RECURRING
  (2 approvals, 12 periods) and ONE_OFF (1 approval, one period).
- Tests: 76 Direct Mode contract tests, 29/29 mutants, frontend tests, calldata table and RPC probe, source hash; CI.
