"""Redis connection pool and helper functions."""

import asyncio
import json
import os
from typing import Optional

import redis.asyncio as aioredis
from dotenv import load_dotenv

load_dotenv()

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Connection pool shared across the app lifetime
_pool: Optional[aioredis.ConnectionPool] = None


def get_pool() -> aioredis.ConnectionPool:
    global _pool
    if _pool is None:
        _pool = aioredis.ConnectionPool.from_url(
            REDIS_URL,
            max_connections=20,
            decode_responses=True,
        )
    return _pool


def get_client() -> aioredis.Redis:
    # Returns a client that borrows from the pool — do NOT close it per-call.
    return aioredis.Redis(connection_pool=get_pool())


# ── Key helpers ──────────────────────────────────────────────────────────────

def profile_key(customer_id: str) -> str:
    return f"customer:{customer_id}:profile"


def risk_key(customer_id: str) -> str:
    return f"customer:{customer_id}:risk"


POPULATION_KEY = "population:insights"


# ── CRUD helpers — no aclose(), the pool manages connections ─────────────────

async def get_profile(customer_id: str) -> Optional[dict]:
    r = get_client()
    raw = await r.get(profile_key(customer_id))
    return json.loads(raw) if raw else None


async def set_risk_result(customer_id: str, data: dict) -> None:
    r = get_client()
    await r.set(risk_key(customer_id), json.dumps(data))


async def get_risk_result(customer_id: str) -> Optional[dict]:
    r = get_client()
    raw = await r.get(risk_key(customer_id))
    return json.loads(raw) if raw else None


async def set_population_insights(data: dict) -> None:
    r = get_client()
    await r.set(POPULATION_KEY, json.dumps(data))


async def get_population_insights() -> Optional[dict]:
    r = get_client()
    raw = await r.get(POPULATION_KEY)
    return json.loads(raw) if raw else None


async def get_all_customer_ids() -> list[str]:
    """Return all customer IDs that have a profile stored."""
    r = get_client()
    keys = await r.keys("customer:*:profile")
    ids = []
    for k in keys:
        parts = k.split(":")
        if len(parts) == 3:
            ids.append(parts[1])
    return ids


async def get_customer_ids_by_risk(risk_level: str) -> list[str]:
    """
    Return customer IDs whose stored risk result matches risk_level.
    'analyzed' returns all IDs that have any risk result.
    Scans customer:*:risk keys only — never touches profile keys.
    """
    r = get_client()
    risk_keys = await r.keys("customer:*:risk")

    sem = asyncio.Semaphore(8)
    matched: list[str] = []

    async def _check(key: str) -> None:
        parts = key.split(":")
        if len(parts) != 3:
            return
        cid = parts[1]
        async with sem:
            raw = await r.get(key)
        if not raw:
            return
        if risk_level == "analyzed":
            matched.append(cid)
            return
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return
        if data.get("risk_level") == risk_level:
            matched.append(cid)

    await asyncio.gather(*[_check(k) for k in risk_keys])
    return matched
