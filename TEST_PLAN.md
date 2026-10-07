# TEST_PLAN

## Cases (each pair shares its surface and carries opposite labels)

| Case | Purpose | Expected |
|---|---|---|
| R1 | Pays the designer to keep the logo current. | RECURRING |
| R2 | Covers the server that hosts our site. | RECURRING |
| R3 | Keeps our seat on the regional river-cleanup board. | RECURRING |
| R4 | Pays the cleaner who does the hall after each meetup. | RECURRING |
| R5 | Our share of the shared office internet. | RECURRING |
| O1 | Pays the designer for the logo. | ONE_OFF |
| O2 | Covers the server we bought for the site. | ONE_OFF |
| O3 | Pays the entry fee for the regional river-cleanup race. | ONE_OFF |
| O4 | Pays the cleaner for the hall after the launch party. | ONE_OFF |
| O5 | Our share of the office internet installation. | ONE_OFF |

- **Kill tests:** R1/O1 … R5/O5 — the rubric does not hint at the mechanism.
- `RECURS_KILLSET_CHECK.py` proves no word or word pair separates the classes, and that the rubric shares no content
  word with any case.

## Deterministic behaviour → test (`tests/contract/test_recurs.py`, Direct Mode, model mocked)

| Behaviour | Test |
|---|---|
| The tooth: same designer, two approvals and a schedule versus one line | `test_tooth_same_designer_two_approvals_and_a_schedule_versus_one_line`, `test_one_off_ignores_declared_periods_and_recurring_keeps_them` |
| Approvals | `test_recurring_stays_pending_while_the_owner_is_the_only_approver`, `test_one_off_needs_exactly_one_approval`, `test_the_requester_never_counts_as_an_approver`, `test_owner_request_needs_other_approvers` |
| The 30-day schedule | `test_periods_fall_due_every_30_days`, `test_later_periods_may_be_paid_before_earlier_ones_once_due`, `test_due_dates_cross_month_year_and_leap_day` |
| Completion, cancel and totals | `test_paying_every_period_completes_the_request`, `test_cancel_stops_the_unpaid_periods`, `test_ledger_totals_count_only_approved_unpaid_periods` |
| Roles | `test_third_wallet_is_refused_by_every_restricted_write`, `test_an_approver_who_is_not_the_owner_cannot_mark_or_add` |
| Ids | `test_whitespace_variants_share_one_request_id`, `test_whitespace_variants_share_one_ledger_id`, `test_same_purpose_by_another_requester_or_in_another_ledger_is_new` |
| Day arithmetic | `test_today_matches_python_date_arithmetic` |
| Fail-safe and validator | `test_fail_safe_on_unparseable_output`, `test_fail_safe_on_unknown_label`, `test_validator_rejects_disagreement_and_bad_shapes` |
| Prompt never sees wallets, amounts, ledger or state; fence is a fixed point | `test_prompt_never_sees_wallets_amounts_ledger_or_state`, `test_fence_strip_is_fixed_point` |
| Every revert string has a dedicated test; check order | `test_every_revert_string_has_exactly_one_dedicated_test`, `test_check_order_approver_before_own_request`, `test_check_order_mark_paid` |
| The planned on-chain table, replayed in order | `test_runtime_table_in_order` |
| Ids and dates shared with the frontend | `test_vectors_match_contract` |

Frontend (`tests/js/*.test.ts`): Python-string parity, ledger and request ids and dates against the contract vectors, view
parsing, every revert sentence equal to the source and fired in the source's order, postconditions for every write,
receipt classification, calldata sizes, source hash, repository rules.
