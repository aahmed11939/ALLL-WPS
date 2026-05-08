"""
SQLite-backed project persistence store.

Projects are stored in a single ``wps_projects.db`` file located next to this
module.  Each row holds a URL-safe slug (primary key), the project display
name, the raw JSON payload, the owner's email address, and ISO-8601
created/updated timestamps.

Slug generation uses UUID4 to guarantee uniqueness across concurrent creates.
Create and update are intentionally separate operations so that:
- ``create_project`` always inserts a fresh row (raises ValueError on conflict).
- ``update_project`` always updates an existing row and preserves ``created_at``.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import time
import uuid
from typing import Any

_DB_PATH = os.path.join(os.path.dirname(__file__), "wps_projects.db")

_DDL = """
CREATE TABLE IF NOT EXISTS projects (
    slug        TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    data        TEXT NOT NULL,
    owner_email TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
"""

_MIGRATION_ADD_OWNER_EMAIL = """
ALTER TABLE projects ADD COLUMN owner_email TEXT NOT NULL DEFAULT '';
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Create the projects table if it doesn't exist, and run migrations."""
    with _connect() as conn:
        conn.execute(_DDL)
        # Migration: add owner_email column if absent (idempotent — SQLite
        # raises OperationalError on duplicate column; we catch and ignore it)
        try:
            conn.execute(_MIGRATION_ADD_OWNER_EMAIL)
        except sqlite3.OperationalError:
            pass  # column already exists
        conn.commit()


def _slugify(name: str) -> str:
    """Convert a display name to a URL-safe base string (no suffix)."""
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "project"


def _new_slug(name: str) -> str:
    """
    Build a globally unique slug by appending a 8-char UUID4 hex fragment to
    the human-readable base.  UUID4 guarantees uniqueness even under concurrent
    creates with identical names — the collision probability per create is
    effectively zero (~1/4 billion on the 8-hex fragment).
    """
    base = _slugify(name)[:40]
    unique_suffix = uuid.uuid4().hex[:8]
    return f"{base}-{unique_suffix}"


def _extract_name(data_json: str) -> str:
    """Extract ``meta.name`` from a JSON string, defaulting to 'Untitled'."""
    try:
        parsed: dict[str, Any] = json.loads(data_json)
    except Exception:
        parsed = {}
    meta = parsed.get("meta")
    name = (meta.get("name") or "") if isinstance(meta, dict) else ""
    return name.strip() or "Untitled"


def _now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def list_projects() -> list[dict]:
    """Return all projects ordered by ``updated_at`` descending."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT slug, name, owner_email, created_at, updated_at"
            " FROM projects ORDER BY updated_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def create_project(data_json: str, owner_email: str = "") -> dict:
    """
    Insert a new project row.

    Slug is derived from ``meta.name`` inside the JSON, suffixed with a
    UUID4 fragment for guaranteed uniqueness.  Raises ``ValueError`` if the
    generated slug already exists (astronomically unlikely but handled).

    Returns a dict with: slug, name, owner_email, created_at, updated_at.
    """
    name = _extract_name(data_json)
    slug = _new_slug(name)
    now = _now_utc()

    with _connect() as conn:
        existing = conn.execute(
            "SELECT slug FROM projects WHERE slug = ?", (slug,)
        ).fetchone()
        if existing:
            raise ValueError(f"Slug collision detected for '{slug}' — please retry.")
        conn.execute(
            "INSERT INTO projects (slug, name, data, owner_email, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (slug, name, data_json, owner_email, now, now),
        )
        conn.commit()

    return {
        "slug": slug, "name": name, "owner_email": owner_email,
        "created_at": now, "updated_at": now,
    }


def update_project(slug: str, data_json: str, owner_email: str | None = None) -> dict:
    """
    Update an existing project row identified by *slug*.

    ``created_at`` is preserved from the original row.  If *owner_email* is
    provided it overwrites the stored value; otherwise the existing value is
    kept.
    Raises ``KeyError`` if *slug* does not exist.

    Returns a dict with: slug, name, owner_email, created_at, updated_at.
    """
    now = _now_utc()
    name = _extract_name(data_json)

    with _connect() as conn:
        row = conn.execute(
            "SELECT created_at, owner_email FROM projects WHERE slug = ?", (slug,)
        ).fetchone()
        if row is None:
            raise KeyError(slug)
        created_at: str = row["created_at"]
        stored_owner: str = row["owner_email"] or ""
        new_owner = owner_email if owner_email is not None else stored_owner
        conn.execute(
            "UPDATE projects SET name=?, data=?, owner_email=?, updated_at=? WHERE slug=?",
            (name, data_json, new_owner, now, slug),
        )
        conn.commit()

    return {
        "slug": slug, "name": name, "owner_email": new_owner,
        "created_at": created_at, "updated_at": now,
    }


def load_project(slug: str) -> dict | None:
    """Return the full project row (including ``data`` JSON string) or None."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT slug, name, data, owner_email, created_at, updated_at"
            " FROM projects WHERE slug=?",
            (slug,),
        ).fetchone()
    if row is None:
        return None
    return dict(row)


def delete_project(slug: str) -> bool:
    """Delete a project row.  Returns True if a row was removed."""
    with _connect() as conn:
        cur = conn.execute("DELETE FROM projects WHERE slug=?", (slug,))
        conn.commit()
    return cur.rowcount > 0
