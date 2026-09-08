"""Small, dependency-optional primitives for CoAutoResearch v2 contracts."""

from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache
from hashlib import sha256
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
from typing import Any, Mapping
from urllib.parse import urlsplit


SCHEMA_VERSION = "2.0"

ID_PATTERNS = {
    "project": re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$"),
    "trial": re.compile(r"^[0-9]{6}_[a-z0-9][a-z0-9-]{0,79}$"),
    "result_card": re.compile(r"^RC-[0-9]{6}-[0-9]{2}$"),
    "line": re.compile(r"^L[0-9]{4}$"),
    "campaign": re.compile(r"^C[0-9]{4}$"),
    "human_task": re.compile(r"^HT-[0-9]{4}$"),
    "transaction": re.compile(r"^TXN-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$"),
    "stage": re.compile(r"^STAGE-[0-9]{6}-[a-f0-9]{8}$"),
    "review": re.compile(r"^RV-[0-9]{6}-[a-z_]+-[0-9]{2}$"),
}

_UTC_Z_RE = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$"
)
_RFC3339_RE = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
    r"(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$"
)


class ContractValidationError(ValueError):
    def __init__(self, errors: list[str]):
        self.errors = tuple(errors)
        super().__init__("; ".join(errors))


def default_schema_dir() -> Path:
    configured = os.environ.get("COAUTO_SCHEMA_DIR")
    candidates = [
        Path(configured) if configured else None,
        Path.cwd() / "schemas",
        Path(__file__).resolve().parents[3] / "schemas",
    ]
    for candidate in candidates:
        if candidate and (candidate / "common.schema.json").is_file():
            return candidate.resolve()
    raise FileNotFoundError("CoAutoResearch v2 schemas directory not found")


@lru_cache(maxsize=8)
def _load_schemas_cached(schema_dir: str) -> dict[str, dict[str, Any]]:
    root = Path(schema_dir)
    schemas: dict[str, dict[str, Any]] = {}
    for path in sorted(root.glob("*.schema.json")):
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError(f"schema is not an object: {path}")
        schemas[path.name] = value
    if "common.schema.json" not in schemas:
        raise FileNotFoundError(f"common.schema.json missing under {root}")
    return schemas


def load_schemas(schema_dir: str | Path | None = None) -> dict[str, dict[str, Any]]:
    root = Path(schema_dir) if schema_dir else default_schema_dir()
    return _load_schemas_cached(str(root.resolve()))


def valid_id(kind: str, value: Any) -> bool:
    pattern = ID_PATTERNS.get(kind)
    if pattern is None:
        raise KeyError(f"unknown ID kind: {kind}")
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def require_id(kind: str, value: Any) -> str:
    if not valid_id(kind, value):
        raise ValueError(f"invalid {kind} ID: {value!r}")
    return value


def normalize_relative_path(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 4096:
        raise ValueError("path must be a non-empty string of at most 4096 characters")
    if (
        value.startswith("/")
        or re.match(r"^[A-Za-z]:", value)
        or "\\" in value
        or "\x00" in value
        or "//" in value
        or value.endswith("/")
    ):
        raise ValueError(f"unsafe relative path: {value!r}")
    parts = value.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError(f"unsafe relative path: {value!r}")
    normalized = PurePosixPath(*parts).as_posix()
    if normalized != value:
        raise ValueError(f"non-canonical relative path: {value!r}")
    return normalized


def is_utc_z_timestamp(value: Any) -> bool:
    if not isinstance(value, str) or not _UTC_Z_RE.fullmatch(value):
        return False
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        return False
    return parsed.utcoffset() == timezone.utc.utcoffset(parsed)


def utc_z_timestamp(value: datetime | None = None) -> str:
    current = value or datetime.now(timezone.utc)
    if current.tzinfo is None:
        raise ValueError("timestamp must be timezone-aware")
    current = current.astimezone(timezone.utc)
    # Keep the fractional width fixed.  Python 3.9's ``fromisoformat`` rejects
    # some non-standard widths (for example five digits), so trimming trailing
    # zeroes made otherwise valid runtime timestamps fail nondeterministically.
    return current.replace(tzinfo=None).isoformat(timespec="microseconds") + "Z"


def utc_timestamp_errors(
    value: Any,
    path: str = "$",
    *,
    now: datetime | None = None,
) -> list[str]:
    reference = now or datetime.now(timezone.utc)
    if reference.tzinfo is None:
        raise ValueError("timestamp validation reference must be timezone-aware")
    reference = reference.astimezone(timezone.utc)
    errors: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}"
            if key.endswith("_at") and child is not None:
                if not is_utc_z_timestamp(child):
                    errors.append(f"{child_path}: expected an RFC 3339 UTC Z timestamp")
                elif datetime.fromisoformat(child[:-1] + "+00:00") > reference:
                    errors.append(f"{child_path}: event timestamp cannot be in the future")
            errors.extend(utc_timestamp_errors(child, child_path, now=reference))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            errors.extend(
                utc_timestamp_errors(child, f"{path}[{index}]", now=reference)
            )
    return errors


def _require_json_value(value: Any, path: str = "$") -> None:
    if value is None or isinstance(value, (str, bool, int)):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"{path}: non-finite JSON number")
        return
    if isinstance(value, list):
        for index, child in enumerate(value):
            _require_json_value(child, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str):
                raise ValueError(f"{path}: JSON object keys must be strings")
            _require_json_value(child, f"{path}.{key}")
        return
    raise TypeError(f"{path}: unsupported JSON value {type(value).__name__}")


def canonical_json(value: Any) -> str:
    """Return the project's hash-spec-v1 deterministic JSON representation."""
    _require_json_value(value)
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def canonical_json_bytes(value: Any) -> bytes:
    return canonical_json(value).encode("utf-8")


def canonical_json_hash(value: Any) -> str:
    return sha256(canonical_json_bytes(value)).hexdigest()


def _json_equal(left: Any, right: Any) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    return left == right


def _json_type_matches(value: Any, expected: str) -> bool:
    if expected == "null":
        return value is None
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "integer":
        return (
            isinstance(value, int)
            and not isinstance(value, bool)
            or isinstance(value, float)
            and value.is_integer()
        )
    return False


def _format_valid(value: str, format_name: str) -> bool:
    if format_name == "date-time":
        if not _RFC3339_RE.fullmatch(value):
            return False
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return False
        return True
    if format_name == "uri":
        if any(character.isspace() for character in value):
            return False
        try:
            parsed = urlsplit(value)
        except ValueError:
            return False
        return bool(parsed.scheme and (parsed.netloc or parsed.path))
    return True


def _resolve_ref(
    ref: str,
    current_name: str,
    schemas: Mapping[str, Mapping[str, Any]],
) -> tuple[Mapping[str, Any], str]:
    name, _, fragment = ref.partition("#")
    target_name = name or current_name
    if target_name not in schemas:
        raise KeyError(f"unresolved schema reference: {ref}")
    target: Any = schemas[target_name]
    if fragment:
        if not fragment.startswith("/"):
            raise KeyError(f"unsupported schema reference: {ref}")
        for part in fragment[1:].split("/"):
            part = part.replace("~1", "/").replace("~0", "~")
            target = target[part]
    if not isinstance(target, Mapping):
        raise TypeError(f"schema reference does not point to an object: {ref}")
    return target, target_name


def _fallback_errors(
    value: Any,
    schema: Mapping[str, Any],
    schemas: Mapping[str, Mapping[str, Any]],
    schema_name: str,
    path: str,
) -> list[str]:
    errors: list[str] = []

    if "$ref" in schema:
        target, target_name = _resolve_ref(str(schema["$ref"]), schema_name, schemas)
        errors.extend(_fallback_errors(value, target, schemas, target_name, path))

    for branch in schema.get("allOf", []):
        errors.extend(_fallback_errors(value, branch, schemas, schema_name, path))

    any_of = schema.get("anyOf")
    if any_of is not None and not any(
        not _fallback_errors(value, branch, schemas, schema_name, path) for branch in any_of
    ):
        errors.append(f"{path}: does not match any allowed schema")

    if "not" in schema and not _fallback_errors(value, schema["not"], schemas, schema_name, path):
        errors.append(f"{path}: matches a forbidden schema")

    if_schema = schema.get("if")
    if if_schema is not None and not _fallback_errors(value, if_schema, schemas, schema_name, path):
        if "then" in schema:
            errors.extend(_fallback_errors(value, schema["then"], schemas, schema_name, path))
    elif if_schema is not None and "else" in schema:
        errors.extend(_fallback_errors(value, schema["else"], schemas, schema_name, path))

    expected_type = schema.get("type")
    if expected_type is not None:
        expected_types = [expected_type] if isinstance(expected_type, str) else list(expected_type)
        if not any(_json_type_matches(value, item) for item in expected_types):
            errors.append(f"{path}: expected {' or '.join(expected_types)}, got {type(value).__name__}")
            return errors

    if "const" in schema and not _json_equal(value, schema["const"]):
        errors.append(f"{path}: expected constant {schema['const']!r}")
    if "enum" in schema and not any(_json_equal(value, option) for option in schema["enum"]):
        errors.append(f"{path}: value {value!r} is not in the allowed enum")

    if isinstance(value, dict):
        required = schema.get("required", [])
        for key in required:
            if key not in value:
                errors.append(f"{path}: missing required property {key!r}")
        properties = schema.get("properties", {})
        for key, child in value.items():
            child_path = f"{path}.{key}"
            if key in properties:
                errors.extend(
                    _fallback_errors(child, properties[key], schemas, schema_name, child_path)
                )
            elif schema.get("additionalProperties") is False:
                errors.append(f"{child_path}: unknown property")
            elif isinstance(schema.get("additionalProperties"), Mapping):
                errors.extend(
                    _fallback_errors(
                        child,
                        schema["additionalProperties"],
                        schemas,
                        schema_name,
                        child_path,
                    )
                )

    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append(f"{path}: expected at least {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append(f"{path}: expected at most {schema['maxItems']} items")
        if schema.get("uniqueItems"):
            seen: set[str] = set()
            for item in value:
                marker = canonical_json(item)
                if marker in seen:
                    errors.append(f"{path}: duplicate array item")
                    break
                seen.add(marker)
        if isinstance(schema.get("items"), Mapping):
            for index, child in enumerate(value):
                errors.extend(
                    _fallback_errors(
                        child,
                        schema["items"],
                        schemas,
                        schema_name,
                        f"{path}[{index}]",
                    )
                )
        if "contains" in schema and not any(
            not _fallback_errors(child, schema["contains"], schemas, schema_name, f"{path}[{index}]")
            for index, child in enumerate(value)
        ):
            errors.append(f"{path}: no item matches contains")

    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append(f"{path}: string is shorter than {schema['minLength']}")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            errors.append(f"{path}: string is longer than {schema['maxLength']}")
        if "pattern" in schema and re.search(schema["pattern"], value) is None:
            errors.append(f"{path}: string does not match {schema['pattern']!r}")
        if "format" in schema and not _format_valid(value, schema["format"]):
            errors.append(f"{path}: invalid {schema['format']} format")

    if (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and "minimum" in schema
        and value < schema["minimum"]
    ):
        errors.append(f"{path}: number is below minimum {schema['minimum']}")

    return errors


def _jsonschema_errors(
    value: Any,
    schema_name: str,
    schemas: Mapping[str, dict[str, Any]],
    schema_dir: Path,
) -> list[str] | None:
    try:
        from jsonschema import Draft202012Validator, FormatChecker
        from referencing import Registry, Resource
        from referencing.jsonschema import DRAFT202012
    except ImportError:
        return None

    registry: Any = Registry()
    for name, schema in schemas.items():
        resource = Resource.from_contents(schema, default_specification=DRAFT202012)
        registry = registry.with_resource((schema_dir / name).resolve().as_uri(), resource)
        if schema.get("$id"):
            registry = registry.with_resource(str(schema["$id"]), resource)
    format_checker = FormatChecker()
    for format_name in ("date-time", "uri"):
        if format_name not in format_checker.checkers:
            format_checker.checks(format_name)(
                lambda instance, name=format_name: not isinstance(instance, str)
                or _format_valid(instance, name)
            )
    validator = Draft202012Validator(
        schemas[schema_name], registry=registry, format_checker=format_checker
    )
    result: list[str] = []
    for error in sorted(validator.iter_errors(value), key=lambda item: list(item.absolute_path)):
        location = "$" + "".join(
            f"[{part}]" if isinstance(part, int) else f".{part}" for part in error.absolute_path
        )
        result.append(f"{location}: {error.message}")
    return result


def schema_errors(
    value: Any,
    schema_name: str,
    *,
    schema_dir: str | Path | None = None,
    engine: str = "auto",
) -> list[str]:
    if engine not in {"auto", "jsonschema", "fallback"}:
        raise ValueError(f"unknown schema engine: {engine}")
    root = Path(schema_dir) if schema_dir else default_schema_dir()
    root = root.resolve()
    schemas = load_schemas(root)
    if schema_name not in schemas:
        raise KeyError(f"unknown schema: {schema_name}")
    if engine != "fallback":
        result = _jsonschema_errors(value, schema_name, schemas, root)
        if result is not None:
            return result
        if engine == "jsonschema":
            raise RuntimeError("jsonschema is not installed")
    return _fallback_errors(value, schemas[schema_name], schemas, schema_name, "$")


def validate_schema(
    value: Any,
    schema_name: str,
    *,
    schema_dir: str | Path | None = None,
    engine: str = "auto",
) -> Any:
    errors = schema_errors(value, schema_name, schema_dir=schema_dir, engine=engine)
    if errors:
        raise ContractValidationError(errors)
    return value
