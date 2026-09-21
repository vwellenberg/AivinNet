"""
The server half of the client/server contract check.

The client tests its request functions against hand-written expectations, the
server tests its endpoints against hand-written requests, and nothing checked
that the two agree. When they drift, both sides stay green and the app breaks:
#36 shipped a required `image` field the client never sent, and every settings
update answered 422.

This test derives a compact contract from the OpenAPI spec the real app builds
(method, path, query and body fields, which are required, json or multipart) and
compares it with the committed copy the client suite reads,
`client/src/requests/__tests__/api-contract.json`. A server change that touches
the contract fails here until the file is regenerated — and the regenerated
file is what makes `requestContract.test.ts` re-check every client request
against it:

    AIVINNET_WRITE_API_CONTRACT=1 uv run pytest tests_api/test_api_contract.py

What it cannot see: behaviour below the spec. #39 (flask_openapi3 dropping a
union-typed file field) had a correct spec and a broken request cycle; that is
what the rest of tests_api/ is for.
"""

import json
import os
from pathlib import Path

CONTRACT_FILE = Path(__file__).parent.parent / "client" / "src" / "requests" / "__tests__" / "api-contract.json"

BODY_TYPES = {"application/json": "json", "multipart/form-data": "multipart"}


def _resolve(spec: dict, schema: dict) -> dict:
    ref = schema.get("$ref")
    if ref is None:
        return schema
    return spec["components"]["schemas"][ref.rsplit("/", 1)[-1]]


def _fields(schema: dict) -> dict:
    properties = schema.get("properties", {})
    fields = {"allowed": sorted(properties), "required": sorted(schema.get("required", []))}
    files = sorted(name for name, prop in properties.items() if prop.get("format") == "binary")
    if files:
        fields["files"] = files
    return fields


def derive_contract(spec: dict) -> dict:
    contract = {}
    for path, operations in spec["paths"].items():
        for method, operation in operations.items():
            entry: dict = {}
            params = operation.get("parameters", [])
            query = [p for p in params if p["in"] == "query"]
            if query:
                entry["query"] = {
                    "allowed": sorted(p["name"] for p in query),
                    "required": sorted(p["name"] for p in query if p.get("required")),
                }

            body = operation.get("requestBody")
            if body:
                ((content_type, media),) = body["content"].items()
                entry["body"] = {"type": BODY_TYPES[content_type], **_fields(_resolve(spec, media["schema"]))}
                if not body.get("required"):
                    entry["body"]["optional"] = True

            contract[f"{method.upper()} {path}"] = entry
    return dict(sorted(contract.items()))


def render(contract: dict) -> str:
    return json.dumps(contract, indent=2, sort_keys=True) + "\n"


def test_contract_file_matches_the_server(built_app):
    rendered = render(derive_contract(built_app.api_doc))

    if os.environ.get("AIVINNET_WRITE_API_CONTRACT"):
        CONTRACT_FILE.write_text(rendered, encoding="utf-8")

    committed = CONTRACT_FILE.read_text(encoding="utf-8") if CONTRACT_FILE.exists() else ""
    assert committed == rendered, (
        "The API contract changed. Regenerate the client's copy and let the client "
        "suite check every request against it:\n"
        "    AIVINNET_WRITE_API_CONTRACT=1 uv run pytest tests_api/test_api_contract.py"
    )


def test_contract_covers_the_known_shapes(built_app):
    """Guards the extractor itself: a parser that breaks goes quietly green."""
    contract = derive_contract(built_app.api_doc)

    assert len(contract) > 100
    update = contract["PUT /playlists/{playlistid}/update"]["body"]
    assert update["type"] == "multipart"
    assert update["files"] == ["image"]
    assert "image" not in update["required"]
    assert set(update["required"]) == {"name", "settings"}
    assert any("query" in entry for entry in contract.values())
