"""
All agents, tools, and the validator step.

Agent 1  — Orchestrator        (pure Python routing, no LLM)
Agent 2  — Risk Analyst        (LLM + tool-use loop)
Agent 3  — Retention Strategist(LLM + tool-use loop)
Agent 4  — Validator           (lightweight LLM step, no tool loop)
Agent 5  — Population Intelligence (LLM + Redis scan, async batch)
"""

import asyncio
import json
import os
import re
from typing import Any

import anthropic
from dotenv import load_dotenv

from redis_client import (
    get_all_customer_ids,
    get_profile,
    get_risk_result,
    set_population_insights,
    set_risk_result,
)
from risk_score import risk_score

load_dotenv()

MODEL = "claude-haiku-4-5-20251001"
# AsyncAnthropic — never blocks the event loop
client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


async def _create_with_retry(**kwargs) -> Any:
    """Call client.messages.create with exponential backoff on 429 rate-limit errors."""
    for attempt in range(6):
        try:
            return await client.messages.create(**kwargs)
        except anthropic.RateLimitError:
            if attempt == 5:
                raise
            wait = 2 ** attempt  # 1, 2, 4, 8, 16, 32 seconds
            await asyncio.sleep(wait)


# ── Tool definitions ──────────────────────────────────────────────────────────

GET_CUSTOMER_PROFILE_TOOL: dict[str, Any] = {
    "name": "get_customer_profile",
    "description": (
        "Fetch the full profile of a customer from the database. "
        "Returns all customer fields as a JSON object."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "customer_id": {
                "type": "string",
                "description": "The unique customer identifier.",
            }
        },
        "required": ["customer_id"],
    },
}


# ── Tool executor helpers ─────────────────────────────────────────────────────

async def _exec_get_customer_profile(tool_input: dict) -> str:
    customer_id = tool_input["customer_id"]
    profile = await get_profile(customer_id)
    if not profile:
        return json.dumps({"error": f"No profile found for customer {customer_id}"})
    return json.dumps(profile)



def _extract_json(text: str) -> str:
    """Extract JSON from LLM output — handles fenced blocks and inline JSON."""
    # ```json { ... } ``` or ``` { ... } ```
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        return match.group(1)
    # Bare { ... } anywhere in the text
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return match.group(0)
    return text.strip()


# ── Agent 2: Risk Analyst ─────────────────────────────────────────────────────

ANALYST_SYSTEM_PROMPT = """You are a Customer Churn Risk Analyst for a telecommunications company.

Your job is to examine a customer's profile in detail and identify the top 3 specific reasons
why this customer is at risk of churning.

You have access to the get_customer_profile tool. Always use it to fetch the latest data
before analyzing.

Your response MUST be a valid JSON object with this exact structure:
{
  "risk_factors": [
    {"factor": "<factor name>", "explanation": "<specific explanation referencing customer data>"},
    {"factor": "<factor name>", "explanation": "<specific explanation referencing customer data>"},
    {"factor": "<factor name>", "explanation": "<specific explanation referencing customer data>"}
  ],
  "summary": "<2-3 sentence overall risk assessment>"
}

Be specific — always reference actual values from the customer profile (e.g., "$95.70/month",
"3 months tenure", "month-to-month contract"). Never give generic explanations."""


async def run_risk_analyst(customer_id: str) -> dict:
    """Agent 2: full tool-use loop."""
    messages = [
        {
            "role": "user",
            "content": f"Analyze churn risk for customer ID: {customer_id}. "
                       "Fetch their profile and identify the top 3 churn risk factors.",
        }
    ]
    tools = [GET_CUSTOMER_PROFILE_TOOL]

    while True:
        response = await _create_with_retry(
            model=MODEL,
            max_tokens=1024,
            system=ANALYST_SYSTEM_PROMPT,
            tools=tools,
            messages=messages,
        )

        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    if block.name == "get_customer_profile":
                        result = await _exec_get_customer_profile(block.input)
                    else:
                        result = json.dumps({"error": f"Unknown tool: {block.name}"})
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": result,
                        }
                    )
            messages.append({"role": "user", "content": tool_results})

        elif response.stop_reason == "end_turn":
            for block in response.content:
                if hasattr(block, "text"):
                    try:
                        return json.loads(_extract_json(block.text))
                    except json.JSONDecodeError:
                        return {
                            "risk_factors": [
                                {"factor": "Parse error", "explanation": block.text}
                            ],
                            "summary": block.text,
                        }
            return {"risk_factors": [], "summary": "No response generated."}
        else:
            break

    return {"risk_factors": [], "summary": "Agent did not complete."}


# ── Agent 3: Retention Strategist ────────────────────────────────────────────

STRATEGIST_SYSTEM_PROMPT = """You are a Customer Retention Strategist for a telecommunications company.

You will receive the output of a Risk Analyst that has identified the top churn risk factors
for a specific customer. Your job is to craft a personalized retention strategy.

You have access to the get_customer_profile tool. Use it to get full customer details.

Your response MUST be a valid JSON object with this exact structure:
{
  "strategy_title": "<short title for this retention strategy>",
  "actions": [
    {
      "action": "<specific action>",
      "rationale": "<why this addresses a specific risk factor — reference customer data>",
      "urgency": "immediate|within_week|within_month"
    }
  ],
  "personalized_offer": "<a specific, concrete offer referencing their actual charges/contract>",
  "success_metric": "<how we'll know if retention was successful>"
}

Be hyper-specific. If the customer pays $95.70/month on a month-to-month contract, say so.
Never give advice that could apply to any customer."""

STRATEGIST_FEEDBACK_PROMPT = """The previous strategy was rejected by the validator.

Validator feedback: {feedback}

Analyst risk factors: {risk_factors}

Please revise your retention strategy. Address the validator's concerns directly
while keeping your response specific to this customer's actual data.
Use get_customer_profile to re-examine the customer data if needed."""


async def run_retention_strategist(
    customer_id: str, analyst_output: dict, validator_feedback: str = ""
) -> dict:
    """Agent 3: full tool-use loop, optional feedback for regeneration."""
    tools = [GET_CUSTOMER_PROFILE_TOOL]

    risk_factors_str = json.dumps(analyst_output.get("risk_factors", []), indent=2)
    summary_str = analyst_output.get("summary", "")

    if validator_feedback:
        user_content = STRATEGIST_FEEDBACK_PROMPT.format(
            feedback=validator_feedback,
            risk_factors=risk_factors_str,
        )
    else:
        user_content = (
            f"Create a retention strategy for customer {customer_id}.\n\n"
            f"Risk Analyst findings:\n"
            f"Summary: {summary_str}\n\n"
            f"Top risk factors:\n{risk_factors_str}\n\n"
            "Fetch the customer profile for full details, then craft a personalized strategy."
        )

    messages = [{"role": "user", "content": user_content}]

    while True:
        response = await _create_with_retry(
            model=MODEL,
            max_tokens=1024,
            system=STRATEGIST_SYSTEM_PROMPT,
            tools=tools,
            messages=messages,
        )

        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    if block.name == "get_customer_profile":
                        result = await _exec_get_customer_profile(block.input)
                    else:
                        result = json.dumps({"error": f"Unknown tool: {block.name}"})
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": result,
                        }
                    )
            messages.append({"role": "user", "content": tool_results})

        elif response.stop_reason == "end_turn":
            for block in response.content:
                if hasattr(block, "text"):
                    try:
                        return json.loads(_extract_json(block.text))
                    except json.JSONDecodeError:
                        return {
                            "strategy_title": "Strategy",
                            "actions": [],
                            "personalized_offer": block.text,
                            "success_metric": "",
                        }
            return {"strategy_title": "", "actions": [], "personalized_offer": "", "success_metric": ""}
        else:
            break

    return {"strategy_title": "", "actions": [], "personalized_offer": "", "success_metric": ""}


# ── Agent 4: Validator (lightweight LLM step) ─────────────────────────────────

VALIDATOR_SYSTEM_PROMPT = """You are a Quality Validator for customer retention strategies.

Given a retention strategy and the original risk factors, determine:
1. Is the strategy grounded in the actual risk factors listed?
2. Does it reference specific customer data points (numbers, contract types, etc.)?
3. Is it free of generic advice that could apply to any customer?

Respond ONLY with a valid JSON object:
{
  "result": "PASS" | "FAIL",
  "feedback": "<if FAIL: specific reason why it fails and what to fix. If PASS: empty string>"
}"""


async def run_validator(risk_factors: list, strategy: dict) -> dict:
    """Agent 4: single async LLM call, no tool loop."""
    user_content = (
        f"Risk factors:\n{json.dumps(risk_factors, indent=2)}\n\n"
        f"Retention strategy:\n{json.dumps(strategy, indent=2)}"
    )

    response = await _create_with_retry(
        model=MODEL,
        max_tokens=512,
        system=VALIDATOR_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )

    for block in response.content:
        if hasattr(block, "text"):
            try:
                return json.loads(_extract_json(block.text))
            except json.JSONDecodeError:
                return {"result": "PASS", "feedback": ""}

    return {"result": "PASS", "feedback": ""}


# ── Agent 1: Orchestrator ─────────────────────────────────────────────────────

async def run_orchestrator(customer_id: str) -> dict:
    """
    Agent 1: pure Python orchestration — no LLM for routing.
    1. Fetch profile from Redis
    2. Score risk (deterministic)
    3. Route to correct sub-agents
    4. Persist and return structured result
    """
    profile = await get_profile(customer_id)
    if not profile:
        return {"error": f"Customer {customer_id} not found in database."}

    level = risk_score(profile)
    result: dict[str, Any] = {
        "customer_id": customer_id,
        "risk_level": level,
        "profile_summary": {
            "contract": profile.get("contract"),
            "tenure": profile.get("tenure"),
            "monthly_charges": profile.get("monthly_charges"),
        },
        "analyst_output": None,
        "retention_strategy": None,
        "validation": None,
    }

    # Risk Analyst runs for all risk levels
    analyst_output = await run_risk_analyst(customer_id)
    result["analyst_output"] = analyst_output

    # Retention Strategist + Validator loop for high only
    if level == "high":
        strategy = await run_retention_strategist(customer_id, analyst_output)
        validation = await run_validator(analyst_output.get("risk_factors", []), strategy)
        result["validation"] = validation

        if validation.get("result") == "FAIL":
            # One regeneration attempt
            strategy = await run_retention_strategist(
                customer_id,
                analyst_output,
                validator_feedback=validation.get("feedback", ""),
            )
            validation2 = await run_validator(analyst_output.get("risk_factors", []), strategy)
            result["validation"] = validation2

        result["retention_strategy"] = strategy

    await set_risk_result(customer_id, result)
    return result


# ── Agent 5: Population Intelligence ─────────────────────────────────────────

async def run_population_intelligence() -> dict:
    """
    Agent 5: statistics computed deterministically in Python, LLM used only
    for the systemic recommendation — avoids context-window overflow.
    """
    ids = await get_all_customer_ids()

    high = medium = low = 0
    factor_counts: dict[str, int] = {}

    for cid in ids:
        risk = await get_risk_result(cid)
        if not risk:
            continue
        level = risk.get("risk_level", "low")
        if level == "high":
            high += 1
        elif level == "medium":
            medium += 1
        else:
            low += 1

        for rf in (risk.get("analyst_output") or {}).get("risk_factors", []):
            f = rf.get("factor", "").strip()
            if f:
                factor_counts[f] = factor_counts.get(f, 0) + 1

    total = high + medium + low
    top_factors = sorted(
        [{"factor": k, "frequency": v} for k, v in factor_counts.items()],
        key=lambda x: x["frequency"],
        reverse=True,
    )[:5]

    # LLM for the recommendation only — compact payload, no context overflow
    summary = {
        "total": total,
        "high": high,
        "medium": medium,
        "low": low,
        "top_factors": top_factors,
    }
    response = await _create_with_retry(
        model=MODEL,
        max_tokens=256,
        system=(
            "You are a telecom strategy analyst. Based on the churn data summary provided, "
            "write one concrete, specific company-wide retention recommendation. "
            'Respond ONLY with valid JSON: {"recommended_systemic_action": "..."}'
        ),
        messages=[{"role": "user", "content": json.dumps(summary)}],
    )

    recommendation = "Focus on converting month-to-month customers to annual contracts with targeted discounts."
    for block in response.content:
        if hasattr(block, "text"):
            try:
                recommendation = json.loads(_extract_json(block.text))[
                    "recommended_systemic_action"
                ]
            except (json.JSONDecodeError, KeyError):
                pass

    result = {
        "total_processed": total,
        "high_risk_count": high,
        "medium_risk_count": medium,
        "low_risk_count": low,
        "top_churn_factors": top_factors,
        "risk_segments": [
            {
                "segment": "High risk (month-to-month, tenure < 12, charges > $65)",
                "churn_rate": round(high / max(total, 1), 2),
            },
            {
                "segment": "Medium risk (one risk factor present)",
                "churn_rate": round(medium / max(total, 1), 2),
            },
            {
                "segment": "Low risk",
                "churn_rate": round(low / max(total, 1), 2),
            },
        ],
        "recommended_systemic_action": recommendation,
    }
    await set_population_insights(result)
    return result
