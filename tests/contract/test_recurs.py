"""
Deterministic tests for contracts/Recurs.py in GenLayer Direct Mode
(genlayer-test: the real py-genlayer v0.2.16 SDK with storage, TreeMap, u256,
Keccak256 and gl.vm.UserError; the model is mocked).

The mocked labels are ASSUMED labels that drive the deterministic code paths.
They say nothing about what the real model returns; the on-chain table does.
The clock is moved with glkit.chain_warp (gl.message_raw["datetime"]).

Run:  python3 -m pytest tests/contract -q -p no:cacheprovider
"""

import datetime
import re
from pathlib import Path

import pytest
from gltest.direct.loader import create_address

from glkit import (J, chain_warp, check_forbidden_constructs, check_revert_coverage, eval_payload, gate_rubric, hx,
                   load_runtime, lo, norm, replay)

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = str(ROOT / "contracts" / "Recurs.py")
GATE = str(next(ROOT.glob("*_KILLSET_CHECK.py")))
RUNTIME = load_runtime(ROOT)

START = "2026-10-05T03:00:00Z"
EPOCH = datetime.date(1970, 1, 1)
LEDGER = "Riverside makers club"

R1 = "Pays the designer to keep the logo current."
R2 = "Covers the server that hosts our site."
R3 = "Keeps our seat on the regional river-cleanup board."
R4 = "Pays the cleaner who does the hall after each meetup."
R5 = "Our share of the shared office internet."
O1 = "Pays the designer for the logo."
O2 = "Covers the server we bought for the site."
O3 = "Pays the entry fee for the regional river-cleanup race."
O4 = "Pays the cleaner for the hall after the launch party."
O5 = "Our share of the office internet installation."
ASSUMED_RECURRING = (R1, R2, R3, R4, R5)

M_NOT_PENDING = "This request is not pending"
M_ONLY_APPROVER = "Only an approver may approve"
M_OWN = "You cannot approve your own request"
M_NOT_APPROVED = "This request is not approved"
M_ONLY_OWNER_PAY = "Only the ledger owner may mark payments"
M_NOT_DUE = "This period is not due yet"
M_ONLY_CANCEL = "Only the requester or the ledger owner may cancel"
M_OWNER_ADD = "Only the ledger owner may add approvers"


def day_of(iso: str) -> int:
    return (datetime.date.fromisoformat(iso[:10]) - EPOCH).days


def mock_labels(vm):
    for text in ASSUMED_RECURRING:
        vm.mock_llm(re.escape(text), '{"outcome":"RECURRING"}')
    vm.mock_llm(r"(?s).*", '{"outcome":"ONE_OFF"}')


def deploy(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    chain_warp(direct_vm, START)
    return contract


@pytest.fixture
def env(direct_vm, direct_deploy):
    contract = deploy(direct_vm, direct_deploy)
    a, b, c, d = (create_address("owner"), create_address("approver"), create_address("requester"),
                  create_address("stranger"))
    mock_labels(direct_vm)
    direct_vm.sender = a
    return direct_vm, contract, a, b, c, d


def lid_for(contract, owner, name=LEDGER):
    return contract._ledger_id(lo(owner), norm(name))


def rid_for(contract, lid, requester, purpose):
    return contract._request_id(lid, lo(requester), norm(purpose))


def open_(vm, contract, owner, name=LEDGER):
    vm.sender = owner
    contract.open_ledger(name)
    return lid_for(contract, owner, name)


def add_(vm, contract, owner, lid, who):
    vm.sender = owner
    contract.add_approver(lid, hx(who))


def setup_ledger(vm, contract, a, b, c):
    lid = open_(vm, contract, a)
    add_(vm, contract, a, lid, b)
    add_(vm, contract, a, lid, c)
    return lid


def req_(vm, contract, who, lid, purpose, amount=25000, periods=12, payee=None):
    vm.sender = who
    contract.request(lid, hx(payee if payee is not None else who), amount, periods, purpose)
    return rid_for(contract, lid, who, purpose)


def appr_(vm, contract, who, rid):
    vm.sender = who
    contract.approve(rid)


def pay_(vm, contract, owner, rid, k):
    vm.sender = owner
    contract.mark_paid(rid, k)


def R(contract, rid):
    return J(contract.get_request(rid))


def L(contract, lid):
    return J(contract.get_ledger(lid))


# ---------------------------------------------------------------------
# The consequence rule
# ---------------------------------------------------------------------

def test_tooth_same_designer_two_approvals_and_a_schedule_versus_one_line(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rec = req_(vm, contract, c, lid, R1)
    one = req_(vm, contract, c, lid, O1, amount=40000)
    assert (R(contract, rec)["outcome"], R(contract, rec)["needed"]) == ("RECURRING", 2)
    assert (R(contract, one)["outcome"], R(contract, one)["needed"]) == ("ONE_OFF", 1)
    today = day_of(START)

    appr_(vm, contract, a, rec)
    row = R(contract, rec)
    assert (row["state"], row["approvals"], row["approvals_left"], row["schedule"]) == ("PENDING", 1, 1, [])
    appr_(vm, contract, b, rec)
    row = R(contract, rec)
    assert (row["state"], row["periods"], row["approved_day"]) == ("APPROVED", 12, today)
    assert [p["due_day"] for p in row["schedule"]] == [today + 30 * k for k in range(12)]
    assert [p["due"] for p in row["schedule"]] == [True] + [False] * 11
    assert row["approved_by"] == [lo(a), lo(b)]

    appr_(vm, contract, a, one)
    row = R(contract, one)
    assert (row["state"], row["approvals"], row["periods"], row["periods_asked"]) == ("APPROVED", 1, 1, 12)
    assert row["schedule"] == [{"k": 0, "due_day": today, "due_date": START[:10], "due": True, "paid": False,
                                "paid_day": None}]


def test_one_off_ignores_declared_periods_and_recurring_keeps_them(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    one = req_(vm, contract, c, lid, O3, periods=7)
    rec = req_(vm, contract, c, lid, R3, periods=3)
    assert R(contract, one)["periods_on_approval"] == 1
    assert R(contract, rec)["periods_on_approval"] == 3
    appr_(vm, contract, a, one)
    appr_(vm, contract, a, rec)
    appr_(vm, contract, b, rec)
    assert (R(contract, one)["periods"], R(contract, one)["periods_asked"]) == (1, 7)
    today = day_of(START)
    assert [p["due_day"] for p in R(contract, rec)["schedule"]] == [today, today + 30, today + 60]


def test_recurring_stays_pending_while_the_owner_is_the_only_approver(env):
    vm, contract, a, b, c, _ = env
    lid = open_(vm, contract, a)
    rid = req_(vm, contract, c, lid, R2)
    appr_(vm, contract, a, rid)
    row = R(contract, rid)
    assert (row["state"], row["approvals"], row["needed"], row["approvals_left"]) == ("PENDING", 1, 2, 1)
    with vm.expect_revert("You have already approved this request"):
        contract.approve(rid)
    add_(vm, contract, a, lid, b)
    appr_(vm, contract, b, rid)
    assert R(contract, rid)["state"] == "APPROVED"


def test_one_off_needs_exactly_one_approval(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, O2, amount=90000)
    appr_(vm, contract, b, rid)
    row = R(contract, rid)
    assert (row["state"], row["approvals"], row["approved_by"]) == ("APPROVED", 1, [lo(b)])
    vm.sender = a
    with vm.expect_revert(M_NOT_PENDING):
        contract.approve(rid)


def test_the_requester_never_counts_as_an_approver(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, b, lid, R4)            # an approver requests
    vm.sender = b
    with vm.expect_revert(M_OWN):
        contract.approve(rid)
    appr_(vm, contract, a, rid)
    assert R(contract, rid)["state"] == "PENDING"
    appr_(vm, contract, c, rid)
    assert (R(contract, rid)["state"], R(contract, rid)["approved_by"]) == ("APPROVED", [lo(a), lo(c)])


def test_owner_request_needs_other_approvers(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, a, lid, O4)
    vm.sender = a
    with vm.expect_revert(M_OWN):
        contract.approve(rid)
    appr_(vm, contract, c, rid)
    assert R(contract, rid)["state"] == "APPROVED"


def test_periods_fall_due_every_30_days(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, R1)
    appr_(vm, contract, a, rid)
    appr_(vm, contract, b, rid)
    pay_(vm, contract, a, rid, 0)
    chain_warp(vm, "2026-11-03T23:59:59Z")          # day 29 after approval
    with vm.expect_revert(M_NOT_DUE):
        contract.mark_paid(rid, 1)
    chain_warp(vm, "2026-11-04T00:00:00Z")          # day 30
    pay_(vm, contract, a, rid, 1)
    with vm.expect_revert(M_NOT_DUE):
        contract.mark_paid(rid, 2)
    chain_warp(vm, "2026-12-04T08:00:00Z")          # day 60
    pay_(vm, contract, a, rid, 2)
    row = R(contract, rid)
    assert [p["paid"] for p in row["schedule"][:4]] == [True, True, True, False]
    assert [p["paid_day"] for p in row["schedule"][:3]] == [day_of(START), day_of(START) + 30, day_of(START) + 60]
    assert row["paid_count"] == 3 and row["state"] == "APPROVED"


def test_later_periods_may_be_paid_before_earlier_ones_once_due(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, R5, periods=3)
    appr_(vm, contract, a, rid)
    appr_(vm, contract, b, rid)
    chain_warp(vm, "2027-01-10T00:00:00Z")
    pay_(vm, contract, a, rid, 2)
    pay_(vm, contract, a, rid, 0)
    assert R(contract, rid)["paid_count"] == 2
    pay_(vm, contract, a, rid, 1)
    assert R(contract, rid)["state"] == "COMPLETED"


def test_paying_every_period_completes_the_request(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, R2, amount=3000, periods=2)
    appr_(vm, contract, a, rid)
    appr_(vm, contract, b, rid)
    pay_(vm, contract, a, rid, 0)
    assert R(contract, rid)["state"] == "APPROVED"
    chain_warp(vm, "2026-11-04T03:00:00Z")
    pay_(vm, contract, a, rid, 1)
    row = R(contract, rid)
    assert (row["state"], row["paid_count"], row["committed_unpaid"], row["paid_total"]) == \
        ("COMPLETED", 2, "0", "6000")
    with vm.expect_revert(M_NOT_APPROVED):
        contract.mark_paid(rid, 1)


def test_one_off_completes_on_its_single_payment(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, O1, amount=40000)
    appr_(vm, contract, a, rid)
    pay_(vm, contract, a, rid, 0)
    assert (R(contract, rid)["state"], R(contract, rid)["paid_total"]) == ("COMPLETED", "40000")


def test_ledger_totals_count_only_approved_unpaid_periods(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rec = req_(vm, contract, c, lid, R1, amount=25000)
    one = req_(vm, contract, c, lid, O1, amount=40000)
    req_(vm, contract, c, lid, R2, amount=3000)                 # stays pending
    led = L(contract, lid)
    assert (led["committed_unpaid"], led["paid_total"], led["pending_count"]) == ("0", "0", 3)
    appr_(vm, contract, a, rec)
    appr_(vm, contract, b, rec)
    appr_(vm, contract, a, one)
    assert L(contract, lid)["committed_unpaid"] == str(12 * 25000 + 40000)
    pay_(vm, contract, a, rec, 0)
    pay_(vm, contract, a, one, 0)
    led = L(contract, lid)
    assert (led["committed_unpaid"], led["paid_total"], led["pending_count"]) == (str(11 * 25000), "65000", 1)
    assert isinstance(led["committed_unpaid"], str) and isinstance(led["paid_total"], str)


def test_cancel_stops_the_unpaid_periods(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, R1, amount=25000)
    appr_(vm, contract, a, rid)
    appr_(vm, contract, b, rid)
    pay_(vm, contract, a, rid, 0)
    vm.sender = c
    contract.cancel(rid)
    row = R(contract, rid)
    assert (row["state"], row["committed_unpaid"], row["paid_total"]) == ("CANCELLED", "0", "25000")
    assert (L(contract, lid)["committed_unpaid"], L(contract, lid)["paid_total"]) == ("0", "25000")
    chain_warp(vm, "2026-11-04T03:00:00Z")
    vm.sender = a
    with vm.expect_revert(M_NOT_APPROVED):
        contract.mark_paid(rid, 1)


def test_owner_may_cancel_a_pending_request_and_an_approver_may_not(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, R3)
    vm.sender = b
    with vm.expect_revert(M_ONLY_CANCEL):
        contract.cancel(rid)
    vm.sender = a
    contract.cancel(rid)
    assert R(contract, rid)["state"] == "CANCELLED"
    vm.sender = b
    with vm.expect_revert(M_NOT_PENDING):
        contract.approve(rid)


def test_today_matches_python_date_arithmetic(env):
    vm, contract, a, *_ = env
    lid = open_(vm, contract, a)
    for iso in ("1970-01-01T00:00:00Z", "2024-02-29T12:00:00Z", "2026-01-01T00:00:00.000Z",
                "2026-12-31T23:59:59Z", "2000-02-29T00:00:00Z", "2100-03-01T00:00:00Z",
                "2026-10-05T03:04:05.000Z", "2027-03-01T00:00:00+00:00"):
        chain_warp(vm, iso)
        assert contract._today() == day_of(iso), iso
        assert contract._day_to_date(day_of(iso)) == iso[:10]
        assert (L(contract, lid)["today"], L(contract, lid)["today_date"]) == (day_of(iso), iso[:10])
    for n in range(0, 80000, 997):
        assert contract._day_to_date(n) == (EPOCH + datetime.timedelta(days=n)).isoformat()


def test_due_dates_cross_month_year_and_leap_day(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    chain_warp(vm, "2027-12-15T10:00:00Z")
    rid = req_(vm, contract, c, lid, R4, periods=4)
    appr_(vm, contract, a, rid)
    appr_(vm, contract, b, rid)
    start = datetime.date(2027, 12, 15)
    expected = [(start + datetime.timedelta(days=30 * k)).isoformat() for k in range(4)]
    assert [p["due_date"] for p in R(contract, rid)["schedule"]] == expected
    assert expected[2] == "2028-02-13" and expected[3] == "2028-03-14"
    assert R(contract, rid)["approved_date"] == "2027-12-15"


# ---------------------------------------------------------------------
# The planned on-chain table, replayed in order from tests/runtime.json
# ---------------------------------------------------------------------

def test_runtime_table_in_order(env):
    vm, contract, a, b, c, _ = env
    today = day_of(START)

    def after(n, ctx):
        ids = ctx["ids"]
        if n == 1:
            led = L(contract, ids["L"])
            assert led["approvers"] == [lo(a)] and led["name"] == LEDGER
            assert (led["today"], led["today_date"]) == (today, START[:10])
            assert J(RUNTIME["rows"][0]["calls"][1]["_result"])["today"] == today
        if n == 2:
            assert L(contract, ids["L"])["approvers"] == [lo(a), lo(b), lo(c)]
        if n == 3:
            row = R(contract, ids["REQ1"])
            assert (row["outcome"], row["needed"], row["state"]) == ("RECURRING", 2, "PENDING")
        if n == 4:
            row = R(contract, ids["REQ2"])
            assert (row["outcome"], row["needed"], row["periods_on_approval"], row["periods_asked"]) == \
                ("ONE_OFF", 1, 1, 12)
        if n == 5:
            assert R(contract, ids["REQ1"])["approvals"] == 0
        if n == 6:
            assert (R(contract, ids["REQ1"])["state"], R(contract, ids["REQ1"])["approvals"]) == ("PENDING", 1)
        if n == 7:
            row = R(contract, ids["REQ1"])
            assert (row["state"], row["periods"]) == ("APPROVED", 12)
            assert (row["schedule"][0]["due"], row["schedule"][1]["due"]) == (True, False)
            assert row["schedule"][1]["due_day"] == today + 30
        if n == 8:
            assert (R(contract, ids["REQ2"])["state"], R(contract, ids["REQ2"])["periods"]) == ("APPROVED", 1)
        if n == 9:
            assert R(contract, ids["REQ1"])["paid_count"] == 0
        if n == 10:
            row = R(contract, ids["REQ1"])
            assert (row["paid_count"], row["schedule"][0]["paid"]) == (1, True)
        if n == 11:
            assert (R(contract, ids["REQ3"])["outcome"], R(contract, ids["REQ3"])["needed"]) == ("RECURRING", 2)
        if n == 12:
            assert (R(contract, ids["REQ4"])["outcome"], R(contract, ids["REQ4"])["needed"]) == ("ONE_OFF", 1)
        if n == 13:
            led = J(RUNTIME["rows"][12]["_result"])
            assert (led["committed_unpaid"], led["paid_total"], led["pending_count"]) == ("315000", "25000", 2)

    ctx = replay(vm, contract, RUNTIME, {"A": a, "B": b, "C": c}, after=after)
    assert set(ctx["ids"]) == {"L", "REQ1", "REQ2", "REQ3", "REQ4"}
    assert len(RUNTIME["rows"]) <= 13
    assert J(contract.get_ledger_requests(ctx["ids"]["L"]))["request_ids"] == \
        [ctx["ids"][k] for k in ("REQ1", "REQ2", "REQ3", "REQ4")]


def test_runtime_id_recipes_match_contract(env):
    _, contract, a, b, c, _ = env
    ctx = {"wallets": {"A": lo(a), "B": lo(b), "C": lo(c)}, "ids": {}}
    lid = None
    for row in RUNTIME["rows"]:
        for call in row.get("calls", [row]):
            if "save" not in call:
                continue
            who = ctx["wallets"][call.get("wallet", row.get("wallet"))]
            if call["method"] == "open_ledger":
                for variant in (call["args"][0], "  " + call["args"][0].replace(" ", "\t ") + " "):
                    got = eval_payload(call["save"]["payload"], [variant], who, ctx)
                    assert got == contract._ledger_id(who, norm(variant))
                lid = eval_payload(call["save"]["payload"], call["args"], who, ctx)
                ctx["ids"][call["save"]["name"]] = lid
            else:
                purpose = call["args"][4]
                for variant in (purpose, " " + purpose.replace(" ", "  ") + "\n"):
                    args = [lid, ctx["wallets"]["C"], call["args"][2], call["args"][3], variant]
                    assert eval_payload(call["save"]["payload"], args, who, ctx) == \
                        contract._request_id(lid, who, norm(variant))
    assert lid == lid_for(contract, a)


# ---------------------------------------------------------------------
# Who may call what
# ---------------------------------------------------------------------

def test_third_wallet_is_refused_by_every_restricted_write(env):
    vm, contract, a, b, c, d = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, O1)
    vm.sender = d
    with vm.expect_revert(M_OWNER_ADD):
        contract.add_approver(lid, hx(d))
    with vm.expect_revert(M_ONLY_APPROVER):
        contract.approve(rid)
    with vm.expect_revert(M_ONLY_CANCEL):
        contract.cancel(rid)
    appr_(vm, contract, a, rid)
    vm.sender = d
    with vm.expect_revert(M_ONLY_OWNER_PAY):
        contract.mark_paid(rid, 0)
    with vm.expect_revert(M_ONLY_CANCEL):
        contract.cancel(rid)
    row = R(contract, rid)
    assert (row["state"], row["paid_count"], row["approved_by"]) == ("APPROVED", 0, [lo(a)])
    assert L(contract, lid)["approvers"] == [lo(a), lo(b), lo(c)]


def test_opening_and_requesting_are_open_to_anyone(env):
    # By design any wallet may open its own ledger and ask any ledger for a payment;
    # only approvers approve and only the owner marks payments.
    vm, contract, a, b, c, d = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, d, lid, O5, payee=b)
    assert (R(contract, rid)["requester"], R(contract, rid)["payee"]) == (lo(d), lo(b))
    own = open_(vm, contract, d, "Stranger's own ledger")
    assert L(contract, own)["owner"] == lo(d)


def test_an_approver_who_is_not_the_owner_cannot_mark_or_add(env):
    vm, contract, a, b, c, d = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, O2)
    appr_(vm, contract, b, rid)
    vm.sender = b
    with vm.expect_revert(M_ONLY_OWNER_PAY):
        contract.mark_paid(rid, 0)
    with vm.expect_revert(M_OWNER_ADD):
        contract.add_approver(lid, hx(d))
    vm.sender = c
    with vm.expect_revert(M_ONLY_OWNER_PAY):
        contract.mark_paid(rid, 0)


# ---------------------------------------------------------------------
# Normalization and ids
# ---------------------------------------------------------------------

def test_whitespace_variants_share_one_request_id(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, O1)
    vm.sender = c
    with vm.expect_revert("This request already exists"):
        contract.request(lid, hx(c), 999, 3, "  Pays the\tdesigner   for the\nlogo. ")
    assert rid_for(contract, lid, c, " Pays  the designer for the logo.\t") == rid
    assert L(contract, lid)["request_count"] == 1


def test_whitespace_variants_share_one_ledger_id(env):
    vm, contract, a, *_ = env
    lid = open_(vm, contract, a)
    vm.sender = a
    with vm.expect_revert("This ledger already exists"):
        contract.open_ledger("  Riverside\tmakers   club ")
    assert lid_for(contract, a, "Riverside  makers\nclub") == lid


def test_same_purpose_by_another_requester_or_in_another_ledger_is_new(env):
    vm, contract, a, b, c, d = env
    lid = setup_ledger(vm, contract, a, b, c)
    r_c = req_(vm, contract, c, lid, R1)
    r_b = req_(vm, contract, b, lid, R1)
    other = open_(vm, contract, d, "Hillside makers club")
    r_c2 = req_(vm, contract, c, other, R1)
    assert len({r_c, r_b, r_c2}) == 3
    assert R(contract, r_c2)["ledger_id"] == other


def test_same_ledger_name_by_another_owner_is_another_ledger(env):
    vm, contract, a, b, *_ = env
    first = open_(vm, contract, a)
    second = open_(vm, contract, b)
    assert first != second and L(contract, second)["owner"] == lo(b)


def test_wallet_case_is_normalized(env):
    vm, contract, a, b, c, _ = env
    lid = open_(vm, contract, a)
    vm.sender = a
    contract.add_approver(lid, "0x" + lo(b)[2:].upper())
    assert L(contract, lid)["approvers"] == [lo(a), lo(b)]
    with vm.expect_revert("This wallet is already an approver"):
        contract.add_approver(lid, "  " + lo(b) + " ")
    vm.sender = c
    contract.request(lid, "0x" + lo(c)[2:].upper(), 100, 1, O1)
    rid = rid_for(contract, lid, c, O1)
    assert R(contract, rid)["payee"] == lo(c)
    appr_(vm, contract, b, rid)
    assert R(contract, rid)["state"] == "APPROVED"


def test_stored_text_is_the_stripped_original(env):
    vm, contract, a, b, c, _ = env
    vm.sender = a
    contract.open_ledger("  Riverside  makers club  ")
    lid = lid_for(contract, a, LEDGER)
    assert L(contract, lid)["name"] == "Riverside  makers club"
    vm.sender = c
    contract.request(lid, hx(c), 10, 1, "  Pays the designer  for the logo.  ")
    rid = rid_for(contract, lid, c, O1)
    assert R(contract, rid)["purpose"] == "Pays the designer  for the logo."


# ---------------------------------------------------------------------
# Fail-safe, validator, fence
# ---------------------------------------------------------------------

def fresh(direct_vm, direct_deploy, response, purpose=R1):
    contract = deploy(direct_vm, direct_deploy)
    a, c = create_address("owner"), create_address("requester")
    direct_vm.mock_llm(r"(?s).*", response)
    lid = open_(direct_vm, contract, a)
    rid = req_(direct_vm, contract, c, lid, purpose)
    return R(contract, rid)


def test_fail_safe_on_unparseable_output(direct_vm, direct_deploy):
    row = fresh(direct_vm, direct_deploy, "not json at all")
    assert (row["outcome"], row["needed"], row["periods_on_approval"]) == ("ONE_OFF", 1, 1)


def test_fail_safe_on_unknown_label(direct_vm, direct_deploy):
    row = fresh(direct_vm, direct_deploy, '{"outcome":"SOMETIMES"}')
    assert (row["outcome"], row["needed"]) == ("ONE_OFF", 1)


def test_fail_safe_on_non_object_json(direct_vm, direct_deploy):
    row = fresh(direct_vm, direct_deploy, '["RECURRING"]')
    assert row["outcome"] == "ONE_OFF"


def test_fenced_json_output_is_parsed(direct_vm, direct_deploy):
    row = fresh(direct_vm, direct_deploy, '```json\n{"outcome":"recurring"}\n```', purpose=O1)
    assert (row["outcome"], row["needed"]) == ("RECURRING", 2)


def test_validator_rejects_disagreement_and_bad_shapes(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    req_(vm, contract, c, lid, O1)                     # mocked ONE_OFF
    assert vm.run_validator() is True
    assert vm.run_validator(leader_result={"outcome": "RECURRING"}) is False
    assert vm.run_validator(leader_result={"outcome": "SOMETIMES"}) is False
    assert vm.run_validator(leader_result="ONE_OFF") is False
    assert vm.run_validator(leader_error=Exception("boom")) is False


def test_validator_accepts_matching_recurring(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    req_(vm, contract, c, lid, R1)                     # mocked RECURRING
    assert vm.run_validator() is True
    assert vm.run_validator(leader_result={"outcome": "recurring"}) is True
    assert vm.run_validator(leader_result={"outcome": "ONE_OFF"}) is False


def test_prompt_never_sees_wallets_amounts_ledger_or_state(direct_vm, direct_deploy):
    contract = deploy(direct_vm, direct_deploy)
    a, b, c = create_address("owner"), create_address("approver"), create_address("requester")
    for who in (a, b, c):
        direct_vm.mock_llm("(?i)" + re.escape(lo(who)[2:]), '{"outcome":"RECURRING"}')
    direct_vm.mock_llm(r"98765|Riverside", '{"outcome":"RECURRING"}')
    direct_vm.mock_llm(r"\b(PENDING|APPROVED|COMPLETED|CANCELLED|periods?|approv\w*|needed|amount)\b",
                       '{"outcome":"RECURRING"}')
    direct_vm.mock_llm(r"(?s).*", '{"outcome":"ONE_OFF"}')
    lid = open_(direct_vm, contract, a)
    add_(direct_vm, contract, a, lid, b)
    rid = req_(direct_vm, contract, c, lid, O1, amount=98765, periods=7, payee=b)
    assert R(contract, rid)["outcome"] == "ONE_OFF"
    appr_(direct_vm, contract, a, rid)
    rid2 = req_(direct_vm, contract, c, lid, O2, amount=98765)
    assert R(contract, rid2)["outcome"] == "ONE_OFF"


def test_prompt_carries_the_purpose_inside_its_tags(direct_vm, direct_deploy):
    contract = deploy(direct_vm, direct_deploy)
    a, c = create_address("owner"), create_address("requester")
    pattern = r"(?s)<UNTRUSTED_PURPOSE>\s*" + re.escape(O1) + r"\s*</UNTRUSTED_PURPOSE>"
    direct_vm.mock_llm(pattern, '{"outcome":"RECURRING"}')
    direct_vm.mock_llm(r"(?s).*", '{"outcome":"ONE_OFF"}')
    lid = open_(direct_vm, contract, a)
    rid = req_(direct_vm, contract, c, lid, O1)
    assert R(contract, rid)["outcome"] == "RECURRING"


def test_fence_strip_is_fixed_point(env):
    _, contract, *_ = env
    assert "<UNTRUSTED_PURPOSE>" not in contract._fence_strip("x <UNTRUSTED_PURP<UNTRUSTED_PURPOSE>OSE> y").upper()
    assert "</UNTRUSTED_PURPOSE>" not in \
        contract._fence_strip("</UNTRUSTED_PUR</UNTRUSTED_PURPOSE>POSE>").upper()
    assert "RECURRING" not in contract._fence_strip("RECURRECURRINGRING").upper()
    assert "ONE_OFF" not in contract._fence_strip("ONE_ONE_OFFOFF").upper()
    # cross-token rebuild: removing a later token must not leave an earlier one behind
    assert "<UNTRUSTED_PURPOSE>" not in contract._fence_strip("<UNTRUSTED_PURPone_offOSE>").upper()
    assert "</UNTRUSTED_PURPOSE>" not in contract._fence_strip("</UNTRUSTED_PURPRECURRINGOSE>").upper()


# ---------------------------------------------------------------------
# Views, limits, rubric, source
# ---------------------------------------------------------------------

def test_views_on_unknown_ids(env):
    _, contract, *_ = env
    for bad in ("0" * 64, "nope", "", "0x" + "f" * 64):
        assert contract.get_ledger(bad) == "{}"
        assert contract.get_request(bad) == "{}"
        assert contract.get_ledger_requests(bad) == "{}"


def test_views_accept_0x_prefix_and_upper_case(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, O1)
    assert L(contract, "0x" + lid)["ledger_id"] == lid
    assert R(contract, rid.upper())["request_id"] == rid
    vm.sender = a
    contract.approve("0x" + rid.upper())
    assert R(contract, rid)["state"] == "APPROVED"


def test_get_ledger_requests_lists_in_order(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    ids = [req_(vm, contract, c, lid, text) for text in (R1, O1, R2)]
    assert J(contract.get_ledger_requests(lid)) == {"ledger_id": lid, "request_ids": ids}
    empty = open_(vm, contract, b, "Empty one")
    assert J(contract.get_ledger_requests(empty)) == {"ledger_id": empty, "request_ids": []}


def test_limits_and_rubric(env):
    _, contract, *_ = env
    lim = J(contract.get_limits())
    assert lim["fail_safe_outcome"] == "ONE_OFF" and lim["model_calls"] == ["request"]
    assert lim["approvals_needed"] == {"RECURRING": 2, "ONE_OFF": 1}
    assert (lim["max_ledger_name_length"], lim["max_approvers"], lim["max_purpose_length"], lim["max_amount"],
            lim["max_periods"], lim["period_days"], lim["max_requests_per_ledger"]) == \
        (60, 5, 100, "1000000000000", 12, 30, 100)
    assert lim["money_used"] is False and lim["clock_used"] is True and lim["preview_endpoint_exposed"] is False
    assert lim["external_web_used"] is False and lim["global_admin"] is False
    assert contract.get_rubric() == gate_rubric(GATE)


def test_no_forbidden_constructs_in_source():
    check_forbidden_constructs(CONTRACT, money=False, clock=True)
    src = Path(CONTRACT).read_text(encoding="utf-8")
    assert "    PURPOSE_OPEN,\n    PURPOSE_CLOSE,\n    RECURRING,\n    ONE_OFF,\n)" in src
    rubric = src.split('RUBRIC = """')[1].split('"""')[0]
    for word in ("subscri", "monthly", "weekly", "annual", "renew", "ongoing", "maintain", "keep", "install",
                 "purchase", "buy", "fee", "rent", "hire"):
        assert not re.search(r"\b" + word, rubric, re.I), word


# ---------------------------------------------------------------------
# One dedicated test per revert string (checked by the meta test below)
# ---------------------------------------------------------------------

def test_revert_ledger_name_empty(env):
    vm, contract, a, *_ = env
    vm.sender = a
    with vm.expect_revert("Ledger name is empty"):
        contract.open_ledger(" \t\n ")


def test_revert_ledger_name_too_long(env):
    vm, contract, a, *_ = env
    vm.sender = a
    with vm.expect_revert("Ledger name is too long"):
        contract.open_ledger("n" * 61)
    contract.open_ledger("n" * 60)


def test_revert_ledger_already_exists(env):
    vm, contract, a, *_ = env
    open_(vm, contract, a)
    vm.sender = a
    with vm.expect_revert("This ledger already exists"):
        contract.open_ledger(LEDGER)


def test_revert_unknown_ledger_id(env):
    vm, contract, a, b, c, _ = env
    vm.sender = a
    with vm.expect_revert("Unknown ledger id"):
        contract.add_approver("0" * 64, hx(b))
    vm.sender = c
    with vm.expect_revert("Unknown ledger id"):
        contract.request("not-an-id", "bad payee", 0, 0, "")


def test_revert_only_owner_adds_approvers(env):
    vm, contract, a, b, c, _ = env
    lid = open_(vm, contract, a)
    vm.sender = b
    with vm.expect_revert(M_OWNER_ADD):
        contract.add_approver(lid, hx(c))


def test_revert_invalid_wallet(env):
    vm, contract, a, *_ = env
    lid = open_(vm, contract, a)
    vm.sender = a
    for bad in ("0x123", "0x" + "g" * 40, "0x" + "0" * 40, "x" * 42):
        with vm.expect_revert("Invalid wallet address"):
            contract.add_approver(lid, bad)


def test_revert_already_an_approver(env):
    vm, contract, a, b, *_ = env
    lid = open_(vm, contract, a)
    vm.sender = a
    with vm.expect_revert("This wallet is already an approver"):
        contract.add_approver(lid, hx(a))
    add_(vm, contract, a, lid, b)
    with vm.expect_revert("This wallet is already an approver"):
        contract.add_approver(lid, hx(b).upper().replace("0X", "0x"))


def test_revert_maximum_approvers(env):
    vm, contract, a, *_ = env
    lid = open_(vm, contract, a)
    members = [create_address(f"member{i}") for i in range(5)]
    for m in members[:4]:
        add_(vm, contract, a, lid, m)
    assert L(contract, lid)["approver_count"] == 5
    vm.sender = a
    with vm.expect_revert("This ledger has the maximum number of approvers"):
        contract.add_approver(lid, hx(members[4]))
    # check order: an existing approver is reported as such even on a full ledger
    with vm.expect_revert("This wallet is already an approver"):
        contract.add_approver(lid, hx(members[0]))


def test_revert_invalid_payee(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    vm.sender = c
    for bad in ("0x123", "0x" + "g" * 40, "0x" + "0" * 40, "x" * 42, ""):
        with vm.expect_revert("Invalid payee address"):
            contract.request(lid, bad, 0, 0, "")


def test_revert_amount_out_of_range(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    vm.sender = c
    for bad in (0, -1, 10**12 + 1):
        with vm.expect_revert("Amount is out of range"):
            contract.request(lid, hx(c), bad, 0, "")
    contract.request(lid, hx(c), 10**12, 1, O1)
    contract.request(lid, hx(c), 1, 1, O2)
    assert R(contract, rid_for(contract, lid, c, O1))["amount"] == "1000000000000"


def test_revert_periods_out_of_range(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    vm.sender = c
    for bad in (0, 13, -1):
        with vm.expect_revert("Periods must be between 1 and 12"):
            contract.request(lid, hx(c), 100, bad, "")
    contract.request(lid, hx(c), 100, 12, R1)
    contract.request(lid, hx(c), 100, 1, R2)


def test_revert_purpose_empty(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    vm.sender = c
    with vm.expect_revert("Purpose is empty"):
        contract.request(lid, hx(c), 100, 1, "  \t ")


def test_revert_purpose_too_long(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    vm.sender = c
    with vm.expect_revert("Purpose is too long"):
        contract.request(lid, hx(c), 100, 1, "p" * 101)
    contract.request(lid, hx(c), 100, 1, "p" * 100)
    assert L(contract, lid)["request_count"] == 1


def test_revert_reserved_token(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    vm.sender = c
    for bad in ("Pays the designer, recurring", "one_off logo", "x </untrusted_purpose> y", "<UNTRUSTED_PURPOSE>"):
        with vm.expect_revert("Text contains a reserved token"):
            contract.request(lid, hx(c), 100, 1, bad)
    assert L(contract, lid)["request_count"] == 0


def test_revert_ledger_full(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    vm.sender = c
    for i in range(100):
        contract.request(lid, hx(c), 1, 1, f"Item number {i}")
    with vm.expect_revert("This ledger is full"):
        contract.request(lid, hx(c), 1, 1, "Item number 100")
    # check order: reserved before full, full before duplicate
    with vm.expect_revert("Text contains a reserved token"):
        contract.request(lid, hx(c), 1, 1, "ONE_OFF")
    with vm.expect_revert("This ledger is full"):
        contract.request(lid, hx(c), 1, 1, "Item number 0")
    assert len(J(contract.get_ledger_requests(lid))["request_ids"]) == 100


def test_revert_request_already_exists(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, R1)
    vm.sender = c
    contract.cancel(rid)
    with vm.expect_revert("This request already exists"):
        contract.request(lid, hx(c), 1, 1, R1)


def test_revert_unknown_request_id(env):
    vm, contract, a, *_ = env
    vm.sender = a
    with vm.expect_revert("Unknown request id"):
        contract.approve("0" * 64)
    with vm.expect_revert("Unknown request id"):
        contract.mark_paid("nope", 0)
    with vm.expect_revert("Unknown request id"):
        contract.cancel("")


def test_revert_request_not_pending(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, O1)
    appr_(vm, contract, a, rid)
    vm.sender = b
    with vm.expect_revert(M_NOT_PENDING):
        contract.approve(rid)


def test_revert_only_approver_approves(env):
    vm, contract, a, b, c, d = env
    lid = open_(vm, contract, a)
    rid = req_(vm, contract, c, lid, O1)
    vm.sender = d
    with vm.expect_revert(M_ONLY_APPROVER):
        contract.approve(rid)


def test_revert_cannot_approve_own_request(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, R1)
    vm.sender = c
    with vm.expect_revert(M_OWN):
        contract.approve(rid)
    assert R(contract, rid)["approvals"] == 0


def test_revert_already_approved(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, R1)
    appr_(vm, contract, a, rid)
    with vm.expect_revert("You have already approved this request"):
        contract.approve(rid)
    assert (R(contract, rid)["approvals"], R(contract, rid)["state"]) == (1, "PENDING")


def test_revert_request_not_approved(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, R1)
    vm.sender = a
    with vm.expect_revert(M_NOT_APPROVED):
        contract.mark_paid(rid, 0)


def test_revert_only_owner_marks_payments(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, O1)
    appr_(vm, contract, a, rid)
    vm.sender = b
    with vm.expect_revert(M_ONLY_OWNER_PAY):
        contract.mark_paid(rid, 0)


def test_revert_unknown_period(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, R1, periods=12)
    appr_(vm, contract, a, rid)
    appr_(vm, contract, b, rid)
    vm.sender = a
    for bad in (12, -1, 100):
        with vm.expect_revert("Unknown period"):
            contract.mark_paid(rid, bad)
    one = req_(vm, contract, c, lid, O1, periods=12)
    appr_(vm, contract, a, one)
    vm.sender = a
    with vm.expect_revert("Unknown period"):
        contract.mark_paid(one, 1)


def test_revert_period_not_due(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, R1)
    appr_(vm, contract, a, rid)
    appr_(vm, contract, b, rid)
    vm.sender = a
    with vm.expect_revert(M_NOT_DUE):
        contract.mark_paid(rid, 1)
    chain_warp(vm, "2027-09-20T00:00:00Z")          # day 350: period 11 is due on day 330
    contract.mark_paid(rid, 11)


def test_revert_period_already_paid(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, R1)
    appr_(vm, contract, a, rid)
    appr_(vm, contract, b, rid)
    pay_(vm, contract, a, rid, 0)
    with vm.expect_revert("This period is already paid"):
        contract.mark_paid(rid, 0)
    assert R(contract, rid)["paid_count"] == 1


def test_revert_request_already_closed(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, O1)
    appr_(vm, contract, a, rid)
    pay_(vm, contract, a, rid, 0)                    # COMPLETED
    vm.sender = c
    with vm.expect_revert("This request is already closed"):
        contract.cancel(rid)
    other = req_(vm, contract, c, lid, O2)
    vm.sender = c
    contract.cancel(other)
    with vm.expect_revert("This request is already closed"):
        contract.cancel(other)


def test_revert_only_requester_or_owner_cancels(env):
    vm, contract, a, b, c, d = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, O1)
    vm.sender = d
    with vm.expect_revert(M_ONLY_CANCEL):
        contract.cancel(rid)


# ---------------------------------------------------------------------
# Check order where the specification fixes it
# ---------------------------------------------------------------------

def test_check_order_add_approver_owner_before_wallet(env):
    vm, contract, a, b, *_ = env
    lid = open_(vm, contract, a)
    vm.sender = b
    with vm.expect_revert(M_OWNER_ADD):
        contract.add_approver(lid, "not a wallet")


def test_check_order_request_inputs(env):
    vm, contract, a, b, c, _ = env
    lid = setup_ledger(vm, contract, a, b, c)
    vm.sender = c
    with vm.expect_revert("Amount is out of range"):
        contract.request(lid, hx(c), 0, 0, "")
    with vm.expect_revert("Periods must be between 1 and 12"):
        contract.request(lid, hx(c), 5, 0, "")
    with vm.expect_revert("Purpose is too long"):
        contract.request(lid, hx(c), 5, 1, "RECURRING " * 11)


def test_check_order_approve_state_before_caller(env):
    vm, contract, a, b, c, d = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, O1)
    appr_(vm, contract, a, rid)
    vm.sender = d
    with vm.expect_revert(M_NOT_PENDING):
        contract.approve(rid)


def test_check_order_approver_before_own_request(env):
    # A requester who is not an approver of the ledger is refused as a non-approver.
    vm, contract, a, b, c, _ = env
    lid = open_(vm, contract, a)
    add_(vm, contract, a, lid, b)
    rid = req_(vm, contract, c, lid, R1)
    vm.sender = c
    with vm.expect_revert(M_ONLY_APPROVER):
        contract.approve(rid)


def test_check_order_mark_paid(env):
    vm, contract, a, b, c, d = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, R1)
    vm.sender = d
    with vm.expect_revert(M_NOT_APPROVED):
        contract.mark_paid(rid, 99)
    appr_(vm, contract, a, rid)
    appr_(vm, contract, b, rid)
    vm.sender = d
    with vm.expect_revert(M_ONLY_OWNER_PAY):
        contract.mark_paid(rid, 99)
    vm.sender = a
    with vm.expect_revert("Unknown period"):
        contract.mark_paid(rid, 12)


def test_check_order_cancel_state_before_caller(env):
    vm, contract, a, b, c, d = env
    lid = setup_ledger(vm, contract, a, b, c)
    rid = req_(vm, contract, c, lid, O1)
    vm.sender = c
    contract.cancel(rid)
    vm.sender = d
    with vm.expect_revert("This request is already closed"):
        contract.cancel(rid)


# ---------------------------------------------------------------------
# Meta: every revert string in the source has exactly one dedicated test
# ---------------------------------------------------------------------

def test_every_revert_string_has_exactly_one_dedicated_test():
    check_revert_coverage(CONTRACT, __file__, globals(), expected_count=28)
