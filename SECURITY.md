# SECURITY

## No money

The contract holds no GEN and moves none. Every write sends value 0; amounts are whole numbers recorded in the ledger.

## Where the central rule lives

Whether a purpose is ongoing or one-time is decided only by validators inside `request`. What follows is deterministic
in the contract: RECURRING needs two approvers and keeps the declared periods; ONE_OFF needs one and is a single period.
The app never decides the outcome: it reads `outcome`, `needed`, `periods_on_approval` and the schedule back from
`get_request` (checked by `tests/js/verify.test.ts`).

## Fail-safe

Unusable or unclear output reads ONE_OFF: nothing becomes a standing commitment on a guess.

## Sign-off

The requester never counts as an approver, even when they are one; each approver signs once; only the ledger owner adds
approvers and marks periods paid, each only once due. The model never sees a wallet, an amount, the period count, the
ledger or any state, so a request cannot steer the reading with them.

## Prompt fence

The purpose sits inside `<UNTRUSTED_PURPOSE>` tags. Both tags and both labels are refused in any letter case on input and
stripped to a fixed point inside the prompt.

## Frontend

- No MetaMask Snap: the app switches the network with `wallet_switchEthereumChain` / `wallet_addEthereumChain`.
- One same-origin RPC proxy (`/genlayer-rpc`, in `vite.config.ts` and `vercel.json`) for reads, receipts and writes.
- A write is reported only after the leader receipt says SUCCESS **and** consensus has reached ACCEPTED, and only after
  the reloaded state shows the change; otherwise "confirmation delayed" with a Check again button that re-reads state.
- Every revert predictable from state disables the button with the contract's own sentence.
- Amounts are parsed as whole numbers with bigint. Contract text is rendered as React text; no raw HTML. Local storage
  holds the ids of ledgers opened in this browser — nothing else.

## Remaining limits

See "Honest limitation" in the README.
