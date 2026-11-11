"""Coverage gate for requirements -> contracts -> schema/events.

Usage:
    python -m contracts.coverage_check            # report, exit 0
    python -m contracts.coverage_check --strict   # fail on hard gaps

Checks:
  G-1  every MUST with a concrete endpoint has that endpoint in OpenAPI
  G-2  docs/29 endpoints and OpenAPI endpoints agree (normalized path params)
  G-3  every table referenced by docs/28 exists in docs/31
  G-4  every test id in docs/28 exists somewhere under tests/ (warning)
  G-5  every event referenced by docs/32 §13A exists in the event index
  G-6  error codes in docs/29 §2 are unique and have an HTTP status

Pure stdlib; no app imports.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
SCHEMAS = ROOT / "schemas"
TESTS = ROOT / "tests"
ALLOWLIST = ROOT / "contracts" / "coverage_allowlist.json"

REQ_ROW = re.compile(r"^\|\s*([A-Z]+-\d+)\s*\|\s*(MUST|SHOULD|COULD)\s*\|")
ERR_ROW = re.compile(r"^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|\s*([0-9]{3}(?:/[0-9]{3})?)\s*\|")
METHOD_PATH = re.compile(
    r"(?P<methods>(?:GET|POST|PUT|PATCH|DELETE)(?:/(?:GET|POST|PUT|PATCH|DELETE))*)"
    r"\s+`?(?P<path>/[^`\s|]*)`?"
)
PATH_PARAM = re.compile(r"\{[^}]+\}")
CODE_SPAN = re.compile(r"`([A-Z][A-Z0-9_]+)`")
EVENT_TYPE = re.compile(r"\b([a-z]+)\.([a-z_]+)\b")

HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def split_row(line: str) -> list[str]:
    """Split a markdown table row, preserving escaped pipes inside cells."""
    body = line.strip().strip("|")
    body = body.replace(r"\|", "\x00")
    return [c.strip().replace("\x00", "|") for c in body.split("|")]


def normalize_path(path: str) -> str:
    path = path.split("?", 1)[0].rstrip("*")
    return PATH_PARAM.sub("{}", path)


def parse_requirements() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for line in read(DOCS / "28-需求追踪矩阵.md").splitlines():
        m = REQ_ROW.match(line)
        if not m:
            continue
        cells = split_row(line)
        if len(cells) < 7:
            continue
        rows.append(
            {
                "id": m.group(1),
                "priority": m.group(2),
                "api": cells[4],
                "tables": cells[5],
                "test": cells[6],
            }
        )
    return rows


def parse_api_doc() -> set[tuple[str, str]]:
    text = read(DOCS / "29-API与错误码总表.md")
    section = text.split("## 3. 端点目录", 1)[1].split("## 4.", 1)[0]
    endpoints: set[tuple[str, str]] = set()
    for line in section.splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = split_row(line)
        if len(cells) < 2:
            continue
        methods = [m for m in cells[0].split("/") if m in HTTP_METHODS]
        path = cells[1].strip("` ")
        if not methods or not path.startswith("/"):
            continue
        for method in methods:
            endpoints.add((method, normalize_path(path)))
    return endpoints


def parse_openapi() -> set[tuple[str, str]]:
    doc = json.loads(read(SCHEMAS / "api" / "openapi.json"))
    endpoints: set[tuple[str, str]] = set()
    for path, ops in doc.get("paths", {}).items():
        for method in ops:
            if method.upper() in HTTP_METHODS:
                endpoints.add((method.upper(), normalize_path(path)))
    return endpoints


def parse_table_names() -> set[str]:
    text = read(DOCS / "31-全量数据模型与DDL.md")
    section = text.split("## 2. 表清单", 1)[1].split("## 3. 核心 DDL", 1)[0]
    names: set[str] = set()
    for line in section.splitlines():
        if line.strip().startswith("`"):
            names.update(re.findall(r"`([a-z][a-z_]+)`", line))
    return names


def parse_event_types() -> set[str]:
    index = json.loads(read(SCHEMAS / "events" / "index.json"))
    return {e["type"] for e in index["events"]}


def parse_state_machine_events() -> set[str]:
    text = read(DOCS / "32-模块接口与状态机.md")
    if "## 13A." not in text:
        return set()
    section = text.split("## 13A.", 1)[1].split("## 14.", 1)[0]
    found: set[str] = set()
    for line in section.splitlines():
        if not line.strip().startswith("|"):
            continue
        for cell in split_row(line):
            found.update(CODE_SPAN.findall(cell))
    return {e for e in found if "." in e}


def parse_error_codes() -> list[tuple[str, str]]:
    text = read(DOCS / "29-API与错误码总表.md")
    section = text.split("## 2. 错误码目录", 1)[1].split("## 3.", 1)[0]
    rows: list[tuple[str, str]] = []
    for line in section.splitlines():
        m = ERR_ROW.match(line)
        if m:
            rows.append((m.group(1), m.group(2)))
    return rows


def requirement_endpoints(api_cell: str) -> set[tuple[str, str]]:
    found: set[tuple[str, str]] = set()
    for m in METHOD_PATH.finditer(api_cell):
        for method in m.group("methods").split("/"):
            found.add((method, normalize_path(m.group("path"))))
    return found


def load_allowlist() -> tuple[set[str], set[str]]:
    if not ALLOWLIST.exists():
        return set(), set()
    data = json.loads(read(ALLOWLIST))
    return set(data.get("endpoints", [])), set(data.get("requirements", []))


def endpoint_key(endpoint: tuple[str, str]) -> str:
    return f"{endpoint[0]} {endpoint[1]}"


def write_allowlist(api_doc: set[tuple[str, str]], openapi: set[tuple[str, str]],
                    requirements: list[dict[str, str]]) -> None:
    docs_only = sorted(endpoint_key(e) for e in api_doc - openapi)
    reqs: set[str] = set()
    for req in requirements:
        missing = requirement_endpoints(req["api"]) - openapi
        if missing and all(endpoint_key(e) in docs_only for e in missing):
            reqs.add(req["id"])
    payload = {
        "comment": "Known backlog: docs/29 endpoints not yet in contracts/spec/api.py. Remove entries as they are implemented.",
        "endpoints": docs_only,
        "requirements": sorted(reqs),
    }
    ALLOWLIST.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {ALLOWLIST.relative_to(ROOT)} ({len(docs_only)} endpoints, {len(reqs)} requirements)")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true", help="exit 1 on hard gaps")
    parser.add_argument("--write-allowlist", action="store_true",
                        help="record current docs/29-only endpoints as known backlog")
    args = parser.parse_args()

    requirements = parse_requirements()
    api_doc = parse_api_doc()
    openapi = parse_openapi()
    tables = parse_table_names()
    events = parse_event_types()
    state_events = parse_state_machine_events()
    error_codes = parse_error_codes()

    if args.write_allowlist:
        write_allowlist(api_doc, openapi, requirements)
        return 0

    allowed_endpoints, allowed_reqs = load_allowlist()
    if args.strict:
        allowed_endpoints, allowed_reqs = set(), set()

    hard: list[str] = []
    soft: list[str] = []
    allowed: list[str] = []

    # G-1: MUST requirements with concrete endpoints must be contracted.
    for req in requirements:
        if req["priority"] != "MUST":
            continue
        missing = requirement_endpoints(req["api"]) - openapi
        if not missing:
            continue
        if req["id"] in allowed_reqs or all(endpoint_key(e) in allowed_endpoints for e in missing):
            allowed.append(f"G-1 {req['id']} backlog endpoint(s): "
                           + ", ".join(sorted(endpoint_key(e) for e in missing)))
        else:
            for endpoint in sorted(missing):
                hard.append(f"G-1 {req['id']} endpoint not in OpenAPI: {endpoint_key(endpoint)}")

    # G-2: docs/29 and OpenAPI agree.
    for endpoint in sorted(api_doc - openapi):
        if endpoint_key(endpoint) in allowed_endpoints:
            allowed.append(f"G-2 docs/29 backlog: {endpoint_key(endpoint)}")
        else:
            hard.append(f"G-2 docs/29 endpoint missing from OpenAPI: {endpoint_key(endpoint)}")
    for endpoint in sorted(openapi - api_doc):
        hard.append(f"G-2 OpenAPI endpoint missing from docs/29: {endpoint_key(endpoint)}")

    # G-3: requirement tables exist.
    for req in requirements:
        for table in re.findall(r"`([a-z][a-z_]+)`", req["tables"]):
            if table not in tables:
                hard.append(f"G-3 {req['id']} references unknown table: {table}")

    # G-4: mapped test ids are load-bearing (hard); the rest stay warnings.
    # contracts/test_map.json maps docs/28 test ids -> the files that cover
    # them. Ratchet: floor rises to 40 at M2 exit (docs/45 W11-12).
    test_map_path = ROOT / "contracts" / "test_map.json"
    test_map: dict[str, list[str]] = {}
    if test_map_path.exists():
        import json as _json
        test_map = _json.loads(read(test_map_path))
    file_text: dict[str, str] = {}
    if TESTS.exists():
        for path in TESTS.rglob("*.py"):
            try:
                file_text[str(path.relative_to(ROOT)).replace("\\", "/")] = read(path)
            except UnicodeDecodeError:
                continue
    test_text = "".join(file_text.values())
    for test_id, files in test_map.items():
        for rel in files:
            if rel not in file_text or test_id not in file_text[rel]:
                hard.append(f"G-4 mapped test missing: {test_id} -> {rel}")
    MAPPED_FLOOR = 30
    if len(test_map) < MAPPED_FLOOR:
        hard.append(
            f"G-4 mapped requirement tests {len(test_map)} < floor {MAPPED_FLOOR}"
        )
    for req in requirements:
        test_id = req["test"].strip("` ")
        if (
            test_id
            and test_id not in {"—", "-"}
            and test_id not in test_map
            and test_id not in test_text
        ):
            soft.append(f"G-4 {req['id']} test not found: {test_id}")

    # G-5: state machines reference contracted events.
    for event in sorted(state_events - events):
        hard.append(f"G-5 state machine references unknown event: {event}")

    # G-6: error codes unique and have HTTP status.
    duplicates = [code for code, count in Counter(c for c, _ in error_codes).items() if count > 1]
    for code in duplicates:
        hard.append(f"G-6 duplicate error code: {code}")
    for code, status in error_codes:
        if not status:
            hard.append(f"G-6 error code without status: {code}")

    print(f"requirements: {len(requirements)}")
    print(f"docs/29 endpoints: {len(api_doc)}  OpenAPI endpoints: {len(openapi)}")
    print(f"tables: {len(tables)}  events: {len(events)}  error codes: {len(error_codes)}")
    print(f"requirement tests mapped (G-4 hard): {len(test_map)}")
    print()
    for label, items in (("HARD", hard), ("WARN", soft), ("ALLOWED", allowed)):
        print(f"{label}: {len(items)}")
        for item in items[:40]:
            print(f"  - {item}")
        if len(items) > 40:
            print(f"  ... {len(items) - 40} more")
        print()

    if args.strict and hard:
        print("coverage gate failed")
        return 1
    print("coverage gate passed (warnings only)" if not hard else "coverage gate has hard gaps")
    return 0


if __name__ == "__main__":
    sys.exit(main())
