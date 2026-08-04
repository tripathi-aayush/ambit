"""Deterministic, rule-based risk scoring for Action Objects.

No ML, no learned weights — a fixed set of additive rules over action type,
target path, branch, and environment. Each rule that fires contributes
points and a human-readable reason, both surfaced to the approval UI and
recorded in the event log.
"""

import re
from dataclasses import dataclass, field

from app.models.action import ActionObject

SENSITIVE_TARGET_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"\.env(\.|$)",
        r"secrets?[/.]",
        r"credentials?",
        r"\.pem$",
        r"id_rsa",
        r"config/production",
    ]
]

PROTECTED_BRANCHES = {"main", "master"}

HIGH_RISK_ACTION_TYPES = {"db_migration"}
ELEVATED_ACTION_TYPES = {"file_delete", "git_push"}
MODERATE_ACTION_TYPES = {"shell_exec"}


@dataclass
class RiskResult:
    score: int
    level: str
    reasons: list[str] = field(default_factory=list)


def score_action(action: ActionObject) -> RiskResult:
    score = 0
    reasons: list[str] = []

    if action.environment.value == "prod":
        score += 40
        reasons.append("targets prod environment")
    elif action.environment.value == "staging":
        score += 15
        reasons.append("targets staging environment")

    if action.action_type.value in HIGH_RISK_ACTION_TYPES:
        score += 30
        reasons.append(f"high-risk action type: {action.action_type.value}")
    elif action.action_type.value in ELEVATED_ACTION_TYPES:
        score += 20
        reasons.append(f"elevated-risk action type: {action.action_type.value}")
    elif action.action_type.value in MODERATE_ACTION_TYPES:
        score += 15
        reasons.append(f"moderate-risk action type: {action.action_type.value}")
    else:
        score += 5

    if action.branch and action.branch.lower() in PROTECTED_BRANCHES:
        score += 25
        reasons.append(f"targets protected branch '{action.branch}'")

    if any(p.search(action.target) for p in SENSITIVE_TARGET_PATTERNS):
        score += 25
        reasons.append(f"target matches a sensitive path pattern: {action.target}")

    score = min(score, 100)

    if score >= 70:
        level = "high"
    elif score >= 35:
        level = "medium"
    else:
        level = "low"

    return RiskResult(score=score, level=level, reasons=reasons)
