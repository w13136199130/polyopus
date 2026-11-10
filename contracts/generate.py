"""Generate JSON Schema, Pydantic models, TypeScript types and OpenAPI.

Usage:
    python -m contracts.generate           # write artifacts
    python -m contracts.generate --check   # verify committed artifacts are in sync

Authoring sources:
    contracts/spec/events.py   (61 events, shared objects)
    contracts/spec/api.py      (/tickets, /attentions)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from .spec import api as api_spec
from .spec import events as ev_spec
from .spec.events import COMMON, EVENTS, Field

ROOT = Path(__file__).resolve().parent.parent
SCHEMAS = ROOT / "schemas"
GEN = ROOT / "generated"

ENVELOPE_REQUIRED = [
    "v", "event_id", "stream_id", "seq", "type", "ts", "tenant_id", "actor", "refs", "payload",
]

ID_PATTERN = r"^[a-z]{1,4}_[0-9A-HJKMNP-TV-Z]{26}$"
STREAM_PATTERN = r"^(conv|ticket|src|user|sys):.+$"


# ---------------------------------------------------------------------------
# type parsing
# ---------------------------------------------------------------------------

def parse_type(t: str) -> tuple[str, Any]:
    if ":" in t:
        root, arg = t.split(":", 1)
    else:
        root, arg = t, None
    if root == "arr":
        assert arg is not None, t
        return "arr", arg
    if root == "enum":
        assert arg is not None, t
        return "enum", arg.split("|")
    if root == "obj":
        assert arg is not None, t
        return "obj", arg
    if root == "ref":
        assert arg is not None, t
        return "ref", arg
    assert root in {"str", "int", "float", "bool", "ts", "json"}, t
    return root, None


def js_type(t: str) -> str:
    root, arg = parse_type(t)
    if root in {"str", "ref", "ts"}:
        return "string"
    if root in {"int", "float"}:
        return "number"
    if root == "bool":
        return "boolean"
    if root == "json":
        return "Record<string, unknown>"
    if root == "enum":
        return " | ".join(json.dumps(x) for x in arg)
    if root == "arr":
        inner = js_type(arg)
        return f"({inner})[]" if "|" in inner else f"{inner}[]"
    if root == "obj":
        return arg
    raise AssertionError(t)


def py_type(t: str) -> str:
    root, arg = parse_type(t)
    if root in {"str", "ref"}:
        return "str"
    if root == "int":
        return "int"
    if root == "float":
        return "float"
    if root == "bool":
        return "bool"
    if root == "ts":
        return "datetime"
    if root == "json":
        return "dict[str, Any]"
    if root == "enum":
        return "Literal[" + ", ".join(json.dumps(x) for x in arg) + "]"
    if root == "arr":
        inner = py_type(arg)
        if "|" in inner and not inner.startswith("Literal["):
            inner = f"({inner})"
        return f"list[{inner}]"
    if root == "obj":
        return arg
    raise AssertionError(t)


def json_schema(t: str, *, ref_prefix: str) -> dict[str, Any]:
    """ref_prefix: '' -> '$defs/X', '../common.schema.json#/$defs' etc."""
    root, arg = parse_type(t)
    if root == "str":
        return {"type": "string"}
    if root == "int":
        return {"type": "integer"}
    if root == "float":
        return {"type": "number"}
    if root == "bool":
        return {"type": "boolean"}
    if root == "ts":
        return {"type": "string", "format": "date-time"}
    if root == "json":
        return {"type": "object", "additionalProperties": True}
    if root == "ref":
        return {"type": "string", "x-id-prefix": arg}
    if root == "enum":
        return {"type": "string", "enum": arg}
    if root == "arr":
        return {"type": "array", "items": json_schema(arg, ref_prefix=ref_prefix)}
    if root == "obj":
        return {"$ref": f"{ref_prefix}/{arg}"}
    raise AssertionError(t)


def fields_schema(fields: tuple[Field, ...], *, ref_prefix: str) -> dict[str, Any]:
    props: dict[str, Any] = {}
    required: list[str] = []
    for p in fields:
        s = json_schema(p.type, ref_prefix=ref_prefix)
        if p.desc:
            s = {**s, "description": p.desc}
        props[p.name] = s
        if p.required:
            required.append(p.name)
    out: dict[str, Any] = {"type": "object", "additionalProperties": False, "properties": props}
    if required:
        out["required"] = required
    return out


def pascal(event_type: str) -> str:
    return "".join(part[:1].upper() + part[1:] for part in re.split(r"[._]", event_type))


# ---------------------------------------------------------------------------
# JSON Schema
# ---------------------------------------------------------------------------

def common_schema() -> dict[str, Any]:
    defs: dict[str, Any] = {}
    for name, fields in COMMON.items():
        defs[name] = fields_schema(fields, ref_prefix="#/$defs")
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://polyopus.dev/schemas/events/common.schema.json",
        "title": "PolyOpus shared event objects",
        "$defs": defs,
    }


def envelope_schema() -> dict[str, Any]:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://polyopus.dev/schemas/events/envelope.schema.json",
        "title": "PolyOpus event envelope",
        "type": "object",
        "additionalProperties": False,
        "required": ["v", "event_id", "stream_id", "seq", "type", "ts", "tenant_id", "actor", "refs", "payload"],
        "properties": {
            "v": {"const": 1},
            "event_id": {"type": "string", "pattern": ID_PATTERN},
            "stream_id": {"type": "string", "pattern": STREAM_PATTERN},
            "seq": {"type": "integer", "minimum": 1},
            "type": {"type": "string", "minLength": 3},
            "ts": {"type": "string", "format": "date-time"},
            "tenant_id": {"type": "string", "minLength": 1},
            "actor": {"$ref": "common.schema.json#/$defs/Actor"},
            "trace_id": {"type": "string", "minLength": 1},
            "causation_id": {"type": "string", "pattern": ID_PATTERN},
            "correlation_id": {"type": "string", "minLength": 1},
            "refs": {"$ref": "../common.schema.json#/$defs/Refs"},
            "payload": {"type": "object"},
            "meta": {"type": "object", "additionalProperties": True},
        },
    }


def event_schema(e) -> dict[str, Any]:
    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": f"https://polyopus.dev/schemas/events/{e.group}/{e.type}.schema.json",
        "title": e.type,
        "description": e.desc or e.type,
        "type": "object",
        "additionalProperties": False,
        "required": ENVELOPE_REQUIRED,
        "properties": {
            "v": {"const": 1},
            "event_id": {"type": "string", "pattern": ID_PATTERN},
            "stream_id": {"type": "string", "pattern": STREAM_PATTERN},
            "seq": {"type": "integer", "minimum": 1},
            "type": {"const": e.type},
            "ts": {"type": "string", "format": "date-time"},
            "tenant_id": {"type": "string", "minLength": 1},
            "actor": {"$ref": "../common.schema.json#/$defs/Actor"},
            "trace_id": {"type": "string", "minLength": 1},
            "causation_id": {"type": "string", "pattern": ID_PATTERN},
            "correlation_id": {"type": "string", "minLength": 1},
            "refs": {"$ref": "../common.schema.json#/$defs/Refs"},
            "payload": fields_schema(e.payload, ref_prefix="../common.schema.json#/$defs"),
            "meta": {"type": "object", "additionalProperties": True},
        },
    }
    return schema


def index_doc() -> dict[str, Any]:
    return {
        "version": 1,
        "generated_from": "contracts/spec/events.py",
        "count": len(EVENTS),
        "events": [
            {
                "type": e.type,
                "group": e.group,
                "stream": e.stream,
                "producer": e.producer,
                "retention": e.retention,
                "schema": f"schemas/events/{e.group}/{e.type}.schema.json",
            }
            for e in EVENTS
        ],
    }


# ---------------------------------------------------------------------------
# Pydantic
# ---------------------------------------------------------------------------

PY_HEADER = '''"""GENERATED by contracts/generate.py — do not edit.

Source: contracts/spec/{source}
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

'''

PY_COMMON = '''

class {name}(BaseModel):
    model_config = ConfigDict(extra="forbid")
{body}

'''


def py_fields(fields: tuple[Field, ...]) -> str:
    lines: list[str] = []
    for p in fields:
        t = py_type(p.type)
        if p.required:
            if p.desc:
                lines.append(f"    {p.name}: {t} = Field(description={json.dumps(p.desc, ensure_ascii=False)})")
            else:
                lines.append(f"    {p.name}: {t}")
        else:
            default = "None"
            if p.desc:
                lines.append(
                    f"    {p.name}: {t} | None = Field(default={default}, "
                    f"description={json.dumps(p.desc, ensure_ascii=False)})"
                )
            else:
                lines.append(f"    {p.name}: {t} | None = {default}")
    return "\n".join(lines)


def pydantic_events() -> str:
    out = [PY_HEADER.format(source="events.py")]
    out.append("\n# ---- shared objects -------------------------------------------------\n")
    for name, fields in COMMON.items():
        body = py_fields(fields)
        out.append(f"\nclass {name}(BaseModel):\n    model_config = ConfigDict(extra=\"forbid\")\n{body}\n")

    out.append(
        "\n\nclass EventBase(BaseModel):\n"
        "    model_config = ConfigDict(extra=\"forbid\")\n"
        "    v: Literal[1] = 1\n"
        "    event_id: str\n"
        "    stream_id: str\n"
        "    seq: int\n"
        "    type: str\n"
        "    ts: datetime\n"
        "    tenant_id: str\n"
        "    actor: Actor\n"
        "    refs: Refs\n"
        "    trace_id: str | None = None\n"
        "    causation_id: str | None = None\n"
        "    correlation_id: str | None = None\n"
        "    meta: dict[str, Any] | None = None\n"
        "\n\n# ---- payloads -------------------------------------------------------\n"
    )
    for e in EVENTS:
        base = pascal(e.type)
        body = py_fields(e.payload)
        out.append(f"\nclass {base}Payload(BaseModel):\n    model_config = ConfigDict(extra=\"forbid\")\n{body}\n")

    out.append("\n\n# ---- events ---------------------------------------------------------\n")
    names: list[str] = []
    for e in EVENTS:
        base = pascal(e.type)
        cls = f"{base}Event"
        names.append(cls)
        out.append(
            f"\nclass {cls}(EventBase):\n"
            f"    type: Literal[{json.dumps(e.type)}] = {json.dumps(e.type)}\n"
            f"    payload: {base}Payload\n"
        )

    union = ", ".join(names)
    out.append(f"\n\nPolyEvent = Annotated[Union[{union}], Field(discriminator=\"type\")]\n")
    out.append("\nEVENT_TYPES: tuple[str, ...] = (\n")
    for e in EVENTS:
        out.append(f"    {json.dumps(e.type)},\n")
    out.append(")\n")
    out.append("\nEVENT_MODELS: dict[str, type[EventBase]] = {\n")
    for e in EVENTS:
        cls = f"{pascal(e.type)}Event"
        out.append(f"    {json.dumps(e.type)}: {cls},\n")
    out.append("}\n")
    out.append(
        "\n_event_adapter = TypeAdapter(PolyEvent)\n\n\n"
        "def parse_event(data: Any) -> EventBase:\n"
        "    \"\"\"Validate one envelope and return the concrete event model.\"\"\"\n"
        "    return _event_adapter.validate_python(data)\n"
    )
    return "".join(out)


def topo_models(models: tuple[api_spec.Model, ...]) -> list[api_spec.Model]:
    by_name = {m.name: m for m in models}
    deps: dict[str, set[str]] = {m.name: set() for m in models}
    for m in models:
        for p in m.fields:
            if p.type.startswith("obj:"):
                deps[m.name].add(p.type[4:])
            elif p.type.startswith("arr:obj:"):
                deps[m.name].add(p.type[len("arr:obj:"):])
    ordered: list[api_spec.Model] = []
    seen: set[str] = set()

    def visit(name: str) -> None:
        if name in seen:
            return
        for d in deps[name]:
            if d in by_name:
                visit(d)
        seen.add(name)
        ordered.append(by_name[name])

    for m in models:
        visit(m.name)
    return ordered


def pydantic_api() -> str:
    out = [PY_HEADER.format(source="api.py")]
    out.append("\n# ---- models ---------------------------------------------------------\n")
    for m in topo_models(api_spec.MODELS):
        body = py_fields(m.fields)
        desc = f"    \"\"\"{m.desc}\"\"\"\n" if m.desc else ""
        out.append(f"\nclass {m.name}(BaseModel):\n{desc}    model_config = ConfigDict(extra=\"forbid\")\n{body}\n")
    return "".join(out)


# ---------------------------------------------------------------------------
# TypeScript
# ---------------------------------------------------------------------------

TS_HEADER = """// GENERATED by contracts/generate.py — do not edit.
// Source: contracts/spec/{source}

"""


def ts_interface(name: str, fields: tuple[Field, ...], indent: str = "") -> str:
    lines = [f"{indent}export interface {name} {{"]
    for p in fields:
        opt = "" if p.required else "?"
        lines.append(f"{indent}  {p.name}{opt}: {js_type(p.type)};")
    lines.append(f"{indent}}}")
    return "\n".join(lines)


def ts_events() -> str:
    out = [TS_HEADER.format(source="events.py")]
    out.append("export interface Actor {\n  kind: \"user\" | \"agent\" | \"system\" | \"executor\" | \"source\";\n  id: string;\n  name?: string;\n  on_behalf_of?: string;\n}\n\n")
    out.append("export interface Refs {\n")
    for name in ("thread_id", "turn_id", "run_id", "ticket_id", "assignment_id", "event_thread_id", "source_id"):
        out.append(f"  {name}?: string;\n")
    out.append("}\n\n")

    # remaining common objects
    for name, fields in COMMON.items():
        if name in {"Actor", "Refs"}:
            continue
        out.append(ts_interface(name, fields) + "\n\n")

    out.append(
        "export interface EventEnvelope {\n"
        "  v: 1;\n"
        "  event_id: string;\n"
        "  stream_id: string;\n"
        "  seq: number;\n"
        "  type: string;\n"
        "  ts: string;\n"
        "  tenant_id: string;\n"
        "  actor: Actor;\n"
        "  refs: Refs;\n"
        "  trace_id?: string;\n"
        "  causation_id?: string;\n"
        "  correlation_id?: string;\n"
        "  meta?: Record<string, unknown>;\n"
        "}\n\n"
    )

    names: list[str] = []
    for e in EVENTS:
        base = pascal(e.type)
        cls = f"{base}Event"
        names.append(cls)
        out.append(ts_interface(f"{base}Payload", e.payload) + "\n\n")
        out.append(
            f"export interface {cls} extends Omit<EventEnvelope, \"type\" | \"payload\"> {{\n"
            f"  type: {json.dumps(e.type)};\n"
            f"  payload: {base}Payload;\n"
            f"}}\n\n"
        )

    out.append("export type PolyEvent =\n  | " + "\n  | ".join(names) + ";\n\n")
    out.append("export const EVENT_TYPES = [\n")
    for e in EVENTS:
        out.append(f"  {json.dumps(e.type)},\n")
    out.append("] as const;\n\n")
    out.append("export type EventType = (typeof EVENT_TYPES)[number];\n\n")
    out.append("export const EVENT_MODELS: Record<EventType, PolyEvent[\"type\"]> = Object.fromEntries(\n  EVENT_TYPES.map((t) => [t, t]),\n) as Record<EventType, PolyEvent[\"type\"]>;\n")
    return "".join(out)


def ts_api() -> str:
    out = [TS_HEADER.format(source="api.py")]
    for m in topo_models(api_spec.MODELS):
        out.append(ts_interface(m.name, m.fields) + "\n\n")
    return "".join(out)


# ---------------------------------------------------------------------------
# OpenAPI
# ---------------------------------------------------------------------------

def openapi_doc() -> dict[str, Any]:
    schemas: dict[str, Any] = {}
    for m in api_spec.MODELS:
        s = fields_schema(m.fields, ref_prefix="#/components/schemas")
        if m.desc:
            s["description"] = m.desc
        schemas[m.name] = s

    paths: dict[str, Any] = {}
    for op in api_spec.OPS:
        params = []
        for p in op.params:
            params.append({
                "name": p.name,
                "in": p.location,
                "required": p.required,
                "description": p.desc or None,
                "schema": json_schema(p.type, ref_prefix="#/components/schemas"),
            })
        for p in params:
            if p["description"] is None:
                del p["description"]

        op_obj: dict[str, Any] = {
            "operationId": op.op_id,
            "summary": op.summary,
            "tags": [op.tag],
            "responses": {
                "200": {
                    "description": "OK",
                    "content": {"application/json": {"schema": {"$ref": f"#/components/schemas/{op.response}"}}},
                },
                "400": {"$ref": "#/components/responses/BadRequest"},
                "401": {"$ref": "#/components/responses/Unauthorized"},
                "403": {"$ref": "#/components/responses/Forbidden"},
                "404": {"$ref": "#/components/responses/NotFound"},
                "409": {"$ref": "#/components/responses/Conflict"},
                "422": {"$ref": "#/components/responses/Unprocessable"},
            },
        }
        if params:
            op_obj["parameters"] = params
        if op.body:
            op_obj["requestBody"] = {
                "required": True,
                "content": {"application/json": {"schema": {"$ref": f"#/components/schemas/{op.body}"}}},
            }
        paths.setdefault(op.path, {})[op.method.lower()] = op_obj

    def err(desc: str) -> dict[str, Any]:
        return {
            "description": desc,
            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}},
        }

    return {
        "openapi": "3.1.0",
        "info": {
            "title": "PolyOpus API",
            "version": "0.1.0",
            "description": "Contracts for the task center: tickets and attentions.",
        },
        "servers": [{"url": "/api/v1"}],
        "tags": [
            {"name": "tickets", "description": "Authorized units of work."},
            {"name": "attentions", "description": "Structured items that need a human decision."},
        ],
        "security": [{"bearerAuth": []}],
        "paths": paths,
        "components": {
            "securitySchemes": {
                "bearerAuth": {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"},
            },
            "schemas": schemas,
            "responses": {
                "BadRequest": err("Malformed request"),
                "Unauthorized": err("Missing or invalid token"),
                "Forbidden": err("Not allowed"),
                "NotFound": err("Not found"),
                "Conflict": err("State conflict"),
                "Unprocessable": err("Validation failed"),
            },
        },
    }


# ---------------------------------------------------------------------------
# emit
# ---------------------------------------------------------------------------

def dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2) + "\n"


def build() -> dict[Path, str]:
    files: dict[Path, str] = {}
    files[SCHEMAS / "events" / "common.schema.json"] = dumps(common_schema())
    files[SCHEMAS / "events" / "envelope.schema.json"] = dumps(envelope_schema())
    files[SCHEMAS / "events" / "index.json"] = dumps(index_doc())
    for e in EVENTS:
        files[SCHEMAS / "events" / e.group / f"{e.type}.schema.json"] = dumps(event_schema(e))

    files[SCHEMAS / "api" / "openapi.json"] = dumps(openapi_doc())

    files[GEN / "py" / "poly_contracts" / "__init__.py"] = (
        '"""Generated contract models. Do not edit."""\n\n'
        "from .api_models import *  # noqa: F401,F403\n"
        "from .events import *  # noqa: F401,F403\n"
    )
    files[GEN / "py" / "poly_contracts" / "events.py"] = pydantic_events()
    files[GEN / "py" / "poly_contracts" / "api_models.py"] = pydantic_api()
    files[GEN / "ts" / "src" / "events.gen.ts"] = ts_events()
    files[GEN / "ts" / "src" / "api.gen.ts"] = ts_api()
    return files


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify artifacts are in sync")
    args = parser.parse_args(argv)

    files = build()
    if args.check:
        stale = [p for p, content in files.items() if not p.exists() or p.read_text(encoding="utf-8") != content]
        if stale:
            print("Out of date (run `python -m contracts.generate`):")
            for p in stale:
                print(f"  - {p.relative_to(ROOT)}")
            return 1
        print(f"contracts in sync: {len(files)} files")
        return 0

    for path, content in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    print(f"generated {len(files)} files:")
    for path in sorted(files):
        print(f"  {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
