"""Optional runtime check for the generated Pydantic models.

Requires pydantic v2 (`pip install pydantic`). The stdlib-only checks live in
`contracts/check.py`; this file proves the generated models actually parse the
examples and enforce the contract.

Usage:
    PYTHONPATH=generated/py python -m contracts.runtime_check
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from pydantic import ValidationError

from poly_contracts import EVENT_TYPES, parse_event
from poly_contracts.api_models import Attention, Ticket, TicketList

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = ROOT / "contracts" / "examples"


def load(name: str) -> dict:
    return json.loads((EXAMPLES / name).read_text(encoding="utf-8"))


def main() -> int:
    assert len(EVENT_TYPES) == 48, len(EVENT_TYPES)

    for name in ("message.delta.json", "eval.decided.json", "assignment.reported.json"):
        data = load(name)
        event = parse_event(data)
        assert event.type == data["type"], (event.type, data["type"])
        print(f"ok    event {data['type']} -> {type(event).__name__}")

    ticket = Ticket.model_validate(load("ticket.json"))
    ticket_list = TicketList.model_validate(load("ticket-list.json"))
    attention = Attention.model_validate(load("attention.json"))
    assert ticket_list.items[0].id == ticket.id
    assert attention.ticketId == ticket.id
    print("ok    api Ticket / TicketList / Attention")

    # unknown type is rejected
    bad = load("message.delta.json")
    bad["type"] = "does.not.exist"
    try:
        parse_event(bad)
    except ValidationError:
        print("ok    unknown event type rejected")
    else:
        print("FAIL  unknown event type accepted")
        return 1

    # unknown payload field is rejected (additionalProperties: false)
    bad = load("message.delta.json")
    bad["payload"]["unexpected"] = True
    try:
        parse_event(bad)
    except ValidationError:
        print("ok    unexpected payload field rejected")
    else:
        print("FAIL  unexpected payload field accepted")
        return 1

    print("\nruntime contract checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
