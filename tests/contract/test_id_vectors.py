"""
Golden ledger-id, request-id and date vectors shared with the frontend
(tests/js/ids.test.ts reads the same file). Every value is computed by the
contract's own code on the real SDK Keccak256.

Regenerate:  WRITE_VECTORS=1 python3 -m pytest tests/contract/test_id_vectors.py
"""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VECTORS = ROOT / "tests" / "js" / "id-vectors.json"
CONTRACT = str(ROOT / "contracts" / "Recurs.py")

OWNER = "0x3065E31B1D993d7C0D59E6786844cBa56780B2d3"
REQUESTER = "0xADE4533b5C00Fc6c8E44F674213c081D919aaD1D"
NAMES = ["Riverside makers club", "  Riverside   makers\tclub ", "Café　des amis", "\u001cChess night\u001f", "﻿Book club"]
PURPOSES = [
    "Pays the designer to keep the logo current.",
    "Pays the designer for the logo.",
    "  Covers the server\u0085that hosts our site. ",
    "Our share of the office internet 🌐",
]
DAYS = [0, 20732, 20733, 20762, 21062, 11016, 20147, -1]


def build(contract):
    ledgers = []
    for name in NAMES:
        ledgers.append({"name": name, "ledger_id": contract._ledger_id(OWNER, contract._normalize_text(name.strip()))})
    lid = ledgers[0]["ledger_id"]
    requests = [{"purpose": p, "request_id": contract._request_id(lid, REQUESTER, contract._normalize_text(p.strip()))} for p in PURPOSES]
    dates = [{"day": d, "date": contract._day_to_date(d)} for d in DAYS]
    return {"owner": OWNER, "requester": REQUESTER, "ledgers": ledgers, "requests": requests, "dates": dates}


def test_vectors_match_contract(direct_deploy):
    data = build(direct_deploy(CONTRACT))
    if os.environ.get("WRITE_VECTORS") == "1":
        VECTORS.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    assert json.loads(VECTORS.read_text(encoding="utf-8")) == data
