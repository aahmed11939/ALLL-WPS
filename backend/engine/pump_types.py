"""
Pump type catalogue for ALLL WPS Designer.

All 16 pump types are registered here with metadata used for:
- UI type-picker cards (name, family, potable tag, description, H/Q ranges)
- Potable-water suitability guidance (tags, compliance notes)
- Type-specific extras requirements (which fields must accompany each type)

Potable suitability tags
------------------------
  recommended  — standard first choice for municipal potable water stations
  conditional  — acceptable with specific constraints documented in potable_notes
  niche        — unusual for potable service; include for completeness;
                 verify suitability with project engineer

Type-specific extras schemas
----------------------------
  None                  — no extra fields required (most centrifugal types)
  "vertical_turbine"    — bowl/column/submergence data
  "submersible"         — depth, motor cooling
  "booster_set"         — setpoint pressure, pump count
  "pd_pump"             — displacement, max pressure, pulsation dampener
  "fire_pump"           — NFPA 20 compliance flag (optional badge)
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Catalogue definition
# ---------------------------------------------------------------------------
# Each entry is a dict conforming to PumpTypeInfo (see schemas.py).
# Keys must be unique; they are used as API request identifiers.

PUMP_TYPE_CATALOGUE: dict[str, dict[str, Any]] = {
    # ------------------------------------------------------------------
    # Centrifugal — recommended
    # ------------------------------------------------------------------
    "end_suction": {
        "key": "end_suction",
        "display_name": "End-Suction Centrifugal",
        "family": "centrifugal",
        "potable_tag": "recommended",
        "description": (
            "Single-stage, horizontal centrifugal with an axial suction nozzle. "
            "The most common pump type in municipal water distribution."
        ),
        "typical_head_range_m": {"min": 5.0, "max": 120.0},
        "typical_flow_range_m3h": {"min": 5.0, "max": 2000.0},
        "constraints": [
            "Requires positive suction head (NPSH_a > NPSH_r).",
            "Seal/packing maintenance required; mechanical seal preferred for potable service.",
            "Single impeller limits achievable head — use multistage for H > ~100 m.",
        ],
        "potable_notes": [
            "All wetted parts must comply with NSF/ANSI 61 (materials) and NSF/ANSI 372 (lead content).",
            "Refer to AWWA C750 / AWWA Centrifugal Pump Standard for hydraulic acceptance testing.",
        ],
        "extras_schema": None,
    },

    "split_case": {
        "key": "split_case",
        "display_name": "Split-Case Centrifugal",
        "family": "centrifugal",
        "potable_tag": "recommended",
        "description": (
            "Horizontally or axially split casing with double-suction impeller. "
            "High efficiency at large flows; easy maintenance access without disturbing pipework."
        ),
        "typical_head_range_m": {"min": 10.0, "max": 150.0},
        "typical_flow_range_m3h": {"min": 100.0, "max": 10000.0},
        "constraints": [
            "Double-suction impeller reduces NPSH requirements compared to end-suction.",
            "Larger footprint and higher installed cost than end-suction equivalents.",
            "Alignment between pump and motor is critical during re-assembly.",
        ],
        "potable_notes": [
            "All wetted parts must comply with NSF/ANSI 61 and NSF/ANSI 372.",
            "Suitable for high-service pump stations and transmission mains.",
        ],
        "extras_schema": None,
    },

    "multistage_centrifugal": {
        "key": "multistage_centrifugal",
        "display_name": "Multistage Centrifugal",
        "family": "centrifugal",
        "potable_tag": "recommended",
        "description": (
            "Multiple impellers in series on a common shaft; each stage adds head. "
            "Ideal for high-pressure booster applications and long transmission pipelines."
        ),
        "typical_head_range_m": {"min": 50.0, "max": 600.0},
        "typical_flow_range_m3h": {"min": 5.0, "max": 1000.0},
        "constraints": [
            "More complex seal arrangement; inter-stage wear rings require monitoring.",
            "High differential pressure increases shaft deflection — check bearing loads.",
            "Minimum flow protection (bypass or recirculation valve) is essential.",
        ],
        "potable_notes": [
            "All wetted materials must comply with NSF/ANSI 61 and NSF/ANSI 372.",
            "Suitable for high-pressure zones and pressure-boosting stations.",
        ],
        "extras_schema": None,
    },

    "self_priming": {
        "key": "self_priming",
        "display_name": "Self-Priming Centrifugal",
        "family": "centrifugal",
        "potable_tag": "conditional",
        "description": (
            "Modified centrifugal with an internal liquid recirculation priming chamber. "
            "Can re-prime without external foot valve after initial fill."
        ),
        "typical_head_range_m": {"min": 5.0, "max": 80.0},
        "typical_flow_range_m3h": {"min": 2.0, "max": 500.0},
        "constraints": [
            "Lower efficiency than standard centrifugal at same duty point.",
            "Priming chamber must remain charged; verify with manufacturer's suction lift limits.",
            "Suction lift typically limited to 6–8 m (sea level); decreases with altitude.",
        ],
        "potable_notes": [
            "Wetted parts must comply with NSF/ANSI 61 — verify priming chamber material.",
            "Foot valve typically eliminated, reducing maintenance; confirm with AHJ.",
            "Less common for primary service; often used as emergency or portable supply.",
        ],
        "extras_schema": None,
    },

    "canned_motor": {
        "key": "canned_motor",
        "display_name": "Canned Motor (Hermetic)",
        "family": "centrifugal",
        "potable_tag": "conditional",
        "description": (
            "Pump and motor share a common hermetically-sealed casing with no shaft seal. "
            "The pumped liquid cools and lubricates the motor bearings."
        ),
        "typical_head_range_m": {"min": 10.0, "max": 200.0},
        "typical_flow_range_m3h": {"min": 1.0, "max": 300.0},
        "constraints": [
            "Motor winding failure from dry-run or low-flow overheating — install flow switch.",
            "Lower motor efficiency due to liquid-filled air gap.",
            "Limited to clean, compatible liquids; particulates damage motor.",
        ],
        "potable_notes": [
            "Motor casing and rotor must be rated for potable contact (NSF/ANSI 61).",
            "Verify motor lubricant is NSF H1 (incidental food/water contact) or confirm non-contact design.",
            "Suitable for chemical dosing or low-flow high-pressure potable applications.",
        ],
        "extras_schema": None,
    },

    "jet_pump": {
        "key": "jet_pump",
        "display_name": "Jet Pump (Ejector)",
        "family": "centrifugal",
        "potable_tag": "niche",
        "description": (
            "Centrifugal pump combined with an ejector/venturi nozzle. Motive fluid "
            "entrains suction fluid via momentum transfer; no rotating parts in contact with suction flow."
        ),
        "typical_head_range_m": {"min": 5.0, "max": 50.0},
        "typical_flow_range_m3h": {"min": 0.5, "max": 30.0},
        "constraints": [
            "Poor efficiency (typically 25–40%) — not suitable for continuous large-flow service.",
            "Performance sensitive to motive pressure and nozzle geometry.",
            "Suction lift limited by motive pump capacity and ejector design.",
        ],
        "potable_notes": [
            "Rare in municipal systems; more common in private well supply.",
            "Verify all materials, including ejector body and nozzle, comply with NSF/ANSI 61.",
            "Confirm with authority having jurisdiction (AHJ) — often not accepted for public water supply.",
        ],
        "extras_schema": None,
    },

    # ------------------------------------------------------------------
    # Vertical turbine
    # ------------------------------------------------------------------
    "vertical_turbine": {
        "key": "vertical_turbine",
        "display_name": "Vertical Turbine",
        "family": "vertical_turbine",
        "potable_tag": "recommended",
        "description": (
            "Multi-stage turbine bowls suspended in a well or wet-pit on a column pipe. "
            "Motor sits above grade; ideal for deep groundwater or large wet-pit installations."
        ),
        "typical_head_range_m": {"min": 15.0, "max": 400.0},
        "typical_flow_range_m3h": {"min": 20.0, "max": 20000.0},
        "constraints": [
            "Column and shaft alignment critical; column sections must be concentric.",
            "Line-shaft lubrication: enclosed oil or open water-lubricated bearings — specify.",
            "Setting depth must maintain minimum bowl submergence (see ANSI/HI 2.1-2.6).",
            "Bowl performance degrades with wear; periodic pull and inspection required.",
        ],
        "potable_notes": [
            "Standard first choice for groundwater supply wells and large wet-pit stations.",
            "Wetted materials must comply with NSF/ANSI 61; specify NSF-certified bowl coatings.",
            "AWWA Standard E101 covers electric motors for vertical turbine pumps.",
        ],
        "extras_schema": "vertical_turbine",
    },

    # ------------------------------------------------------------------
    # Inline booster
    # ------------------------------------------------------------------
    "inline_booster": {
        "key": "inline_booster",
        "display_name": "Inline Multistage Booster / Booster Set",
        "family": "booster",
        "potable_tag": "recommended",
        "description": (
            "Compact multistage pump (or factory-assembled set with multiple pumps and VFDs) "
            "designed to boost pressure in a distribution zone or building."
        ),
        "typical_head_range_m": {"min": 20.0, "max": 300.0},
        "typical_flow_range_m3h": {"min": 2.0, "max": 500.0},
        "constraints": [
            "Requires stable inlet pressure; install inlet pressure switch for dry-run protection.",
            "Factory skid sets include controls, expansion vessel, and pressure transmitters.",
            "Minimum flow / no-flow conditions can overheat motor — ensure bypass or cycling control.",
        ],
        "potable_notes": [
            "All wetted parts must comply with NSF/ANSI 61 and NSF/ANSI 372.",
            "Preferred for pressure zone boosting; manufacturer pre-certification simplifies AHJ approval.",
        ],
        "extras_schema": "booster_set",
    },

    # ------------------------------------------------------------------
    # Submersible
    # ------------------------------------------------------------------
    "submersible": {
        "key": "submersible",
        "display_name": "Submersible (potable-rated)",
        "family": "submersible",
        "potable_tag": "conditional",
        "description": (
            "Pump and motor in a single hermetic unit designed for submerged operation. "
            "Eliminates long column pipe; motor cooled by flow past the motor casing."
        ),
        "typical_head_range_m": {"min": 5.0, "max": 200.0},
        "typical_flow_range_m3h": {"min": 5.0, "max": 2000.0},
        "constraints": [
            "Motor cooling depends on through-flow — minimum continuous flow must be maintained.",
            "Cable entry seal is a critical failure point; use submersible-grade cable and glands.",
            "Requires wet-well access for pull-out; guide rail or guide wire installation recommended.",
            "Thermal protection (motor winding thermistor) strongly recommended.",
        ],
        "potable_notes": [
            "Specify 'potable water duty' motor with NSF/ANSI 61-certified motor oil and casing material.",
            "Motor lubricating oil must be food-grade (NSF H1) or confirm hermetic seal integrity.",
            "Motor cooling flow must exceed manufacturer's minimum — design flow range accordingly.",
            "Verify installation depth provides required motor cooling velocity past motor can.",
        ],
        "extras_schema": "submersible",
    },

    # ------------------------------------------------------------------
    # Axial / mixed flow
    # ------------------------------------------------------------------
    "axial_flow": {
        "key": "axial_flow",
        "display_name": "Axial Flow / Mixed Flow",
        "family": "axial_flow",
        "potable_tag": "conditional",
        "description": (
            "Propeller or mixed-flow impeller producing very high flow at low head. "
            "Used for flood-control, irrigation pumping stations, and large-volume low-lift transfer."
        ),
        "typical_head_range_m": {"min": 1.0, "max": 20.0},
        "typical_flow_range_m3h": {"min": 500.0, "max": 100000.0},
        "constraints": [
            "Extremely steep H-Q curve — unstable at low flow; may require variable pitch or VFD.",
            "High specific speed impeller is sensitive to cavitation at reduced flow.",
            "Large structural footprint; typically installed in wet-pit or open-channel configuration.",
        ],
        "potable_notes": [
            "Used in large raw-water pumping stations (river intakes); less common for treated water.",
            "Wetted parts must comply with NSF/ANSI 61 for potable service.",
            "Verify with AHJ — some jurisdictions restrict open-impeller pumps in treated water systems.",
        ],
        "extras_schema": None,
    },

    # ------------------------------------------------------------------
    # Positive displacement — all sub-types
    # ------------------------------------------------------------------
    "pd_screw": {
        "key": "pd_screw",
        "display_name": "PD — Screw",
        "family": "positive_displacement",
        "potable_tag": "niche",
        "description": (
            "One or more helical screws rotate within a close-tolerance casing, "
            "displacing fluid axially. Near-constant flow, quiet operation, handles entrained air."
        ),
        "typical_head_range_m": {"min": 20.0, "max": 300.0},
        "typical_flow_range_m3h": {"min": 0.5, "max": 200.0},
        "constraints": [
            "No valved dead-end operation — pressure relief valve mandatory.",
            "Tight clearances susceptible to abrasive particles; filtered supply required.",
            "Flow is nearly proportional to speed — VFD provides excellent flow control.",
        ],
        "potable_notes": [
            "Rarely specified for potable water supply; more common in chemical transfer.",
            "All wetted materials must comply with NSF/ANSI 61 — limited off-the-shelf availability.",
            "Confirm with AHJ; may require third-party material certification.",
        ],
        "extras_schema": "pd_pump",
    },

    "pd_gear": {
        "key": "pd_gear",
        "display_name": "PD — Gear",
        "family": "positive_displacement",
        "potable_tag": "niche",
        "description": (
            "Intermeshing gears trap and transport fluid between tooth spaces. "
            "High differential pressure capability at low to moderate flows."
        ),
        "typical_head_range_m": {"min": 50.0, "max": 1000.0},
        "typical_flow_range_m3h": {"min": 0.2, "max": 100.0},
        "constraints": [
            "Pressure relief valve mandatory — PD pumps must never be dead-headed.",
            "Tight gear tolerances are sensitive to solid contamination.",
            "Pulsation dampener recommended on discharge piping.",
        ],
        "potable_notes": [
            "Extremely niche for potable water — primarily used for chemical dosing or fuel transfer.",
            "Gear lubricant must be food-grade (NSF H1) or pump must use dry/sealed bearing design.",
            "NSF/ANSI 61 compliance for all wetted components required.",
        ],
        "extras_schema": "pd_pump",
    },

    "pd_progressive_cavity": {
        "key": "pd_progressive_cavity",
        "display_name": "PD — Progressive Cavity",
        "family": "positive_displacement",
        "potable_tag": "niche",
        "description": (
            "Eccentric helical rotor turns within an elastomeric stator, creating progressing "
            "cavities that move fluid from inlet to outlet at constant pressure."
        ),
        "typical_head_range_m": {"min": 10.0, "max": 120.0},
        "typical_flow_range_m3h": {"min": 0.5, "max": 100.0},
        "constraints": [
            "Elastomeric stator is temperature- and chemical-sensitive — verify compatibility.",
            "Never run dry — stator damage occurs within seconds of dry operation.",
            "Pressure relief valve mandatory.",
        ],
        "potable_notes": [
            "More common in sludge and chemical service than potable water.",
            "Stator elastomer must be NSF/ANSI 61-listed for potable contact.",
            "Verify with AHJ for potable water duty approval.",
        ],
        "extras_schema": "pd_pump",
    },

    "pd_diaphragm": {
        "key": "pd_diaphragm",
        "display_name": "PD — Diaphragm",
        "family": "positive_displacement",
        "potable_tag": "niche",
        "description": (
            "Flexible diaphragm (mechanical or pneumatic) alternately compresses and expands "
            "to displace fluid through check valves. No rotating parts contact the fluid."
        ),
        "typical_head_range_m": {"min": 10.0, "max": 200.0},
        "typical_flow_range_m3h": {"min": 0.05, "max": 50.0},
        "constraints": [
            "Significant pulsation on both suction and discharge; dampener required.",
            "Diaphragm fatigue life is the primary maintenance item — schedule replacement.",
            "Check valve fouling is the most common failure mode.",
        ],
        "potable_notes": [
            "Used for chemical dosing (chlorine, fluoride, coagulant) in potable treatment.",
            "Diaphragm material must be compatible with chemical and NSF/ANSI 61 listed.",
            "Pulsation dampener mandatory per most authority guidelines for dosing pumps.",
        ],
        "extras_schema": "pd_pump",
    },

    "pd_peristaltic": {
        "key": "pd_peristaltic",
        "display_name": "PD — Peristaltic",
        "family": "positive_displacement",
        "potable_tag": "niche",
        "description": (
            "Rollers or shoes compress a flexible hose/tube, pushing fluid ahead of the "
            "compression zone. Fluid contacts only the tube interior — zero cross-contamination."
        ),
        "typical_head_range_m": {"min": 5.0, "max": 80.0},
        "typical_flow_range_m3h": {"min": 0.01, "max": 20.0},
        "constraints": [
            "Tube life is limited by fatigue and chemical compatibility — monitor and replace.",
            "Pulsating flow profile; dampener recommended for accurate flow measurement downstream.",
            "Maximum continuous pressure limited by tube material and wall thickness.",
        ],
        "potable_notes": [
            "Excellent for chemical dosing where zero contamination of dosing solution is required.",
            "Tube material must be listed for potable contact (NSF/ANSI 61); common materials: natural rubber, EPDM, silicone.",
            "Not typically used as a primary supply pump; suited to dosing and sampling duties.",
        ],
        "extras_schema": "pd_pump",
    },

    # ------------------------------------------------------------------
    # Fire pump
    # ------------------------------------------------------------------
    "fire_pump": {
        "key": "fire_pump",
        "display_name": "Fire Pump",
        "family": "fire_pump",
        "potable_tag": "niche",
        "description": (
            "Listed centrifugal pump designed and tested to NFPA 20 for fire suppression service. "
            "May also serve as a domestic/potable booster in some configurations."
        ),
        "typical_head_range_m": {"min": 20.0, "max": 250.0},
        "typical_flow_range_m3h": {"min": 40.0, "max": 3000.0},
        "constraints": [
            "Must be listed and labeled per NFPA 20 for fire service — not interchangeable with standard pumps.",
            "Dedicated power supply, controller, and weekly test run required per NFPA 20 §12.",
            "Churn (shut-off) pressure must not exceed system rating; pressure relief required.",
        ],
        "potable_notes": [
            "Classified 'niche' for domestic/potable service — typically a dedicated fire-only system.",
            "If combined fire/domestic system, all wetted materials must comply with NSF/ANSI 61.",
            "Coordinate with AHJ and fire marshal; cross-connection control is mandatory.",
        ],
        "extras_schema": "fire_pump",
    },
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

VALID_POTABLE_TAGS = {"recommended", "conditional", "niche"}
VALID_FAMILIES = {
    "centrifugal",
    "vertical_turbine",
    "booster",
    "submersible",
    "axial_flow",
    "positive_displacement",
    "fire_pump",
}


def get_pump_type(key: str) -> dict:
    """
    Return the catalogue entry for *key*.

    Raises
    ------
    KeyError
        If *key* is not in the catalogue.
    """
    try:
        return PUMP_TYPE_CATALOGUE[key]
    except KeyError:
        valid = sorted(PUMP_TYPE_CATALOGUE.keys())
        raise KeyError(
            f"Unknown pump type key '{key}'. "
            f"Valid keys: {valid}"
        )


def list_pump_types(sort_by_family: bool = True) -> list[dict]:
    """
    Return all catalogue entries as a list.

    Parameters
    ----------
    sort_by_family : bool
        If True, sort by (family, display_name). Default True.
    """
    items = list(PUMP_TYPE_CATALOGUE.values())
    if sort_by_family:
        items.sort(key=lambda p: (p["family"], p["display_name"]))
    return items


def extras_schema_for_key(key: str) -> str | None:
    """Return the extras_schema value for a given pump type key, or None."""
    return get_pump_type(key)["extras_schema"]
