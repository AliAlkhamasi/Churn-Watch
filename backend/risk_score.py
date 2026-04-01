"""
Deterministic risk scoring — no LLM involved.

Rules:
  high   → month-to-month contract AND tenure < 12 AND monthly_charges > 65
  medium → any ONE of the above conditions
  low    → none of the above conditions
"""

from typing import Literal

RiskLevel = Literal["high", "medium", "low"]


def risk_score(profile: dict) -> RiskLevel:
    is_monthly = str(profile.get("contract", "")).lower() == "month-to-month"
    try:
        tenure = float(profile.get("tenure", 0))
    except (ValueError, TypeError):
        tenure = 0.0
    try:
        monthly_charges = float(profile.get("monthly_charges", 0))
    except (ValueError, TypeError):
        monthly_charges = 0.0

    short_tenure = tenure < 12
    high_charges = monthly_charges > 65

    if is_monthly and short_tenure and high_charges:
        return "high"
    if is_monthly or short_tenure or high_charges:
        return "medium"
    return "low"
