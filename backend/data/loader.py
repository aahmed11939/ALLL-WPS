"""
Data loaders for ALLL WPS Designer.

Loads reference data from YAML files in the backend/data directory.
All data is cached at module import time (read-once on server start).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Optional

import yaml

_DATA_DIR = Path(__file__).parent


@lru_cache(maxsize=1)
def load_pipe_materials() -> dict[str, dict]:
    """
    Return the pipe materials dictionary keyed by material code.

    Example return value::

        {
            "ductile_iron": {
                "roughness_mm": 0.12,
                "description": "Ductile Iron (cement-mortar lined)",
                "note": "..."
            },
            ...
        }
    """
    path = _DATA_DIR / "pipe_materials.yaml"
    with open(path, "r") as fh:
        data = yaml.safe_load(fh)
    return data["materials"]


@lru_cache(maxsize=1)
def load_pump_library() -> list[dict]:
    """
    Return the list of pump records from pump_library.yaml.
    """
    path = _DATA_DIR / "pump_library.yaml"
    with open(path, "r") as fh:
        data = yaml.safe_load(fh)
    return data["pumps"]


def get_pump_by_id(pump_id: str) -> Optional[dict]:
    """
    Look up a pump record by its ``id`` field.

    Parameters
    ----------
    pump_id : str  The pump identifier (e.g. ``"KSB-ETANORM-125-100-200"``).

    Returns
    -------
    The full pump record dict, or None if not found.
    """
    for record in load_pump_library():
        if record.get("id") == pump_id:
            return record
    return None


def get_roughness_m(material: str) -> float:
    """
    Look up the absolute roughness [m] for a named pipe material.

    Parameters
    ----------
    material : str  Key matching a material in pipe_materials.yaml.

    Raises
    ------
    KeyError if material is not found.
    """
    materials = load_pipe_materials()
    if material not in materials:
        available = sorted(materials.keys())
        raise KeyError(
            f"Unknown material '{material}'. Available: {available}"
        )
    return materials[material]["roughness_mm"] / 1000.0


def get_material_options() -> list[dict[str, str]]:
    """
    Return a list of {key, label} dicts for populating a UI dropdown.
    """
    materials = load_pipe_materials()
    return [
        {"key": k, "label": v["description"]}
        for k, v in materials.items()
    ]


@lru_cache(maxsize=1)
def load_accessories_library() -> list[dict]:
    """
    Return the list of accessory records from accessories_library.yaml.

    Each record has: id, category, name, default_K, K_min, K_max, notes,
    potable_notes.
    """
    path = _DATA_DIR / "accessories_library.yaml"
    with open(path, "r") as fh:
        data = yaml.safe_load(fh)
    return data["accessories"]


def get_accessory_by_id(accessory_id: str) -> Optional[dict]:
    """
    Look up an accessory record by its ``id`` field.

    Parameters
    ----------
    accessory_id : str  The accessory identifier (e.g. ``"cv_swing"``).

    Returns
    -------
    The full accessory record dict, or None if not found.
    """
    for record in load_accessories_library():
        if record.get("id") == accessory_id:
            return record
    return None


def get_accessories_by_category(category: str) -> list[dict]:
    """
    Return all accessory records for a given category.

    Parameters
    ----------
    category : str  e.g. "check_valve", "meter", "isolation_valve"

    Returns
    -------
    List of matching records (may be empty for unknown categories).
    """
    return [r for r in load_accessories_library() if r.get("category") == category]
