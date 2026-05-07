"""
Data loaders for ALLL WPS Designer.

Loads reference data from YAML files in the backend/data directory.
All data is cached at module import time (read-once on server start).
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

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
