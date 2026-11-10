"""Validate the contract artifacts.

Checks:
  1. generated files are in sync with contracts/spec/*
  2. every event schema is valid JSON with an index entry
  3. examples validate against their JSON Schema (mini validator, stdlib only)
  4. OpenAPI: unique operationIds, path params declared, refs resolve
  5. Pydantic output compiles; TS output has 61 event types

Usage:
    python -m contracts.check
"""

from __future__ import annotations

import json
import py_compile
import re
import sys
from pathlib import Path
from typing import Any

from .generate import ROOT, build

SCHEMAS = ROOT / "schemas"
EXAMPLES = ROOT / "contracts" / "examples"
GEN = ROOT / "generated"


# ---------------------------------------------------------------------------
# JSON loading & refs
# ---------------------------------------------------------------------------

_docs: dict[Path, Any] = {}


def load(path: Path) -> Any:
    path = path.resolve()
    if path not in _docs:
        _docs[path] = json.loads(path.read_text(encoding="utf-8"))
    return _docs[path]


def resolve_ref(ref: str, base: Path) -> tuple[Any, Path]:
    file_part, _, pointer = ref.partition("#")
    if file_part:
        target = (base.parent / file_part).resolve()
        doc = load(target)
        base = target
    else:
        doc = load(base)
    node: Any = doc
    for part in pointer.strip("/").split("/"):
        if not part:
            continue
        part = part.replace("~1", "/").replace("~0", "~")
        node = node[part]
    return node, base


# ---------------------------------------------------------------------------
# mini JSON Schema validator (subset used by our generated schemas)
# ---------------------------------------------------------------------------

def _type_ok(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    return True


def validate(value: Any, schema: dict[str, Any], base: Path, path: str = "$") -> list[str]:
    errors: list[str] = []

    if "$ref" in schema:
        target, target_base = resolve_ref(schema["$ref"], base)
        return validate(value, target, target_base, path)

    if "const" in schema and value != schema["const"]:
        errors.append(f"{path}: expected const {schema['const']!r}, got {value!r}")

    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: {value!r} not in enum {schema['enum']}")

    expected = schema.get("type")
    if expected is not None:
        types = expected if isinstance(expected, list) else [expected]
        if not any(_type_ok(value, t) for t in types):
            errors.append(f"{path}: expected type {expected}, got {type(value).__name__}")
            return errors

    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append(f"{path}: shorter than {schema['minLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append(f"{path}: does not match pattern {schema['pattern']}")
        if schema.get("format") == "date-time" and not re.search(
            r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$", value
        ):
            errors.append(f"{path}: not an RFC3339 date-time")

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{path}: {value} < minimum {schema['minimum']}")

    if isinstance(value, dict):
        props = schema.get("properties", {})
        for key in schema.get("required", []):
            if key not in value:
                errors.append(f"{path}: missing required property {key!r}")
        if schema.get("additionalProperties") is False:
            for key in value:
                if key not in props:
                    errors.append(f"{path}: unexpected property {key!r}")
        for key, sub in props.items():
            if key in value:
                errors.extend(validate(value[key], sub, base, f"{path}.{key}"))

    if isinstance(value, list) and "items" in schema:
        for i, item in enumerate(value):
            errors.extend(validate(item, schema["items"], base, f"{path}[{i}]"))

    return errors


# ---------------------------------------------------------------------------
# checks
# ---------------------------------------------------------------------------

def check_sync() -> list[str]:
    expected = build()
    stale = [p for p, content in expected.items() if not p.exists() or p.read_text(encoding="utf-8") != content]
    return [f"stale generated file: {p.relative_to(ROOT)}" for p in stale]


def check_index() -> list[str]:
    errors: list[str] = []
    index = load(SCHEMAS / "events" / "index.json")
    events = index["events"]
    if len(events) != 61:
        errors.append(f"index has {len(events)} events, expected 61")
    if len({e['type'] for e in events}) != len(events):
        errors.append("index has duplicate event types")
    for e in events:
        path = ROOT / e["schema"]
        if not path.exists():
            errors.append(f"missing schema for {e['type']}")
            continue
        doc = load(path)
        if doc.get("title") != e["type"]:
            errors.append(f"{e['type']}: title mismatch")
        if doc["properties"]["type"].get("const") != e["type"]:
            errors.append(f"{e['type']}: type const mismatch")
        if doc["properties"]["stream_id"]["pattern"] != r"^(conv|ticket|src|user|sys):.+$":
            errors.append(f"{e['type']}: stream pattern mismatch")
    return errors


API_EXAMPLES = {
    "ticket.json": "Ticket",
    "ticket-list.json": "TicketList",
    "attention.json": "Attention",
}


def check_examples() -> list[str]:
    errors: list[str] = []
    openapi_path = SCHEMAS / "api" / "openapi.json"
    openapi = load(openapi_path)
    for path in sorted(EXAMPLES.glob("*.json")):
        data = load(path)
        etype = data.get("type")
        if etype:
            schema_path = SCHEMAS / "events" / _group_for(etype) / f"{etype}.schema.json"
            if not schema_path.exists():
                errors.append(f"{path.name}: no schema for {etype}")
                continue
            errs = validate(data, load(schema_path), schema_path, path.name)
        else:
            component = API_EXAMPLES.get(path.name)
            if component is None:
                errors.append(f"{path.name}: unknown API example (add it to API_EXAMPLES)")
                continue
            schema = openapi["components"]["schemas"][component]
            errs = validate(data, schema, openapi_path, path.name)
        errors.extend(errs)
    return errors


def _group_for(etype: str) -> str:
    groups = {
        "conv": ["turn", "message", "reasoning", "tool", "approval", "steer", "context", "plan", "artifact", "error"],
        "intake": ["trigger", "eval"],
        "ticket": ["ticket", "assignment", "channel"],
        "user": ["attention"],
        "sys": ["watchdog", "usage"],
    }
    domain = etype.split(".", 1)[0]
    for group, domains in groups.items():
        if domain in domains:
            return group
    raise KeyError(etype)


def check_openapi() -> list[str]:
    errors: list[str] = []
    path = SCHEMAS / "api" / "openapi.json"
    doc = load(path)
    if not str(doc.get("openapi", "")).startswith("3.1"):
        errors.append("openapi version must be 3.1.x")

    op_ids: set[str] = set()
    for route, methods in doc["paths"].items():
        for method, op in methods.items():
            if op["operationId"] in op_ids:
                errors.append(f"duplicate operationId {op['operationId']}")
            op_ids.add(op["operationId"])
            if "200" not in op["responses"]:
                errors.append(f"{op['operationId']}: missing 200")
            declared = {p["name"] for p in op.get("parameters", []) if p["in"] == "path"}
            for name in re.findall(r"\{([^}]+)\}", route):
                if name not in declared:
                    errors.append(f"{op['operationId']}: path param {name} not declared")
            if op.get("requestBody"):
                ref = op["requestBody"]["content"]["application/json"]["schema"]["$ref"]
                if ref.split("/")[-1] not in doc["components"]["schemas"]:
                    errors.append(f"{op['operationId']}: unknown body ref {ref}")
            for code, resp in op["responses"].items():
                if "$ref" in resp:
                    name = resp["$ref"].split("/")[-1]
                    if name not in doc["components"]["responses"]:
                        errors.append(f"{op['operationId']}: unknown response ref {name}")

    for name, schema in doc["components"]["schemas"].items():
        _walk_refs(schema, doc, errors, f"components.{name}")
    return errors


def _walk_refs(node: Any, doc: dict[str, Any], errors: list[str], path: str) -> None:
    if isinstance(node, dict):
        if "$ref" in node:
            ref = node["$ref"]
            if ref.startswith("#/components/schemas/"):
                target = ref.split("/")[-1]
                if target not in doc["components"]["schemas"]:
                    errors.append(f"{path}: unresolved ref {ref}")
        for key, value in node.items():
            _walk_refs(value, doc, errors, f"{path}.{key}")
    elif isinstance(node, list):
        for i, item in enumerate(node):
            _walk_refs(item, doc, errors, f"{path}[{i}]")


def check_generated() -> list[str]:
    errors: list[str] = []
    for rel in ("generated/py/poly_contracts/events.py", "generated/py/poly_contracts/api_models.py"):
        path = ROOT / rel
        try:
            py_compile.compile(str(path), doraise=True)
        except py_compile.PyCompileError as exc:
            errors.append(f"{rel}: {exc.msg}")

    ts = (ROOT / "generated/ts/src/events.gen.ts").read_text(encoding="utf-8")
    event_types = re.findall(r'^  type: "([a-z]+(?:\.[a-z_]+)?)";$', ts, re.M)
    if len(event_types) != 61:
        errors.append(f"events.gen.ts: expected 61 event interfaces, found {len(event_types)}")
    names = re.findall(r"export interface (\w+)", ts)
    if len(names) != len(set(names)):
        errors.append("events.gen.ts: duplicate interface names")
    members = re.findall(r"^\s*\| (\w+)", ts.split("export type PolyEvent =", 1)[1].split(";", 1)[0], re.M)
    if len(members) != 61:
        errors.append(f"events.gen.ts: PolyEvent union has {len(members)} members")
    return errors


def main() -> int:
    checks = [
        ("generated in sync", check_sync),
        ("event index", check_index),
        ("examples", check_examples),
        ("openapi", check_openapi),
        ("generated code", check_generated),
    ]
    failed = 0
    for name, fn in checks:
        errors = fn()
        if errors:
            failed += 1
            print(f"FAIL  {name}")
            for e in errors[:20]:
                print(f"      {e}")
        else:
            print(f"ok    {name}")
    if failed:
        print(f"\n{failed} check group(s) failed")
        return 1
    print("\nall contract checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
