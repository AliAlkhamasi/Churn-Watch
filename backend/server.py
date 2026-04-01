"""FastAPI application — Customer Churn Prevention System."""

import asyncio
import os

import json

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv

from agents import run_orchestrator, run_population_intelligence
from redis_client import (
    get_all_customer_ids,
    get_customer_ids_by_risk,
    get_population_insights,
    get_profile,
    get_risk_result,
)

load_dotenv()

app = FastAPI(title="Churn Prevention API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Customer endpoints ────────────────────────────────────────────────────────

@app.post("/api/customer/{customer_id}/analyze")
async def analyze_customer(customer_id: str):
    """Run the full multi-agent pipeline for a single customer."""
    profile = await get_profile(customer_id)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Customer {customer_id} not found.")
    result = await run_orchestrator(customer_id)
    return result


@app.get("/api/customer/{customer_id}/result")
async def get_customer_result(customer_id: str):
    """Return previously stored analysis result for a customer."""
    result = await get_risk_result(customer_id)
    if not result:
        raise HTTPException(status_code=404, detail="No analysis found for this customer.")
    return result


# ── Population endpoints ──────────────────────────────────────────────────────

@app.post("/api/population/analyze")
async def analyze_population():
    """Trigger Population Intelligence Agent (async batch)."""
    result = await run_population_intelligence()
    return result


@app.get("/api/population/insights")
async def get_population():
    """Return the latest Population Intelligence JSON."""
    data = await get_population_insights()
    if not data:
        raise HTTPException(status_code=404, detail="No population insights yet. Run /api/population/analyze first.")
    return data


# ── Customer list endpoint ────────────────────────────────────────────────────

VALID_RISK_FILTERS = {"high", "medium", "low", "analyzed"}
VALID_CONTRACT_FILTERS = {"Month-to-month", "One year", "Two year"}

@app.get("/api/customers")
async def list_customers(
    page: int = 1,
    page_size: int = 100,
    risk_filter: str | None = None,
    contract_filter: str | None = None,
):
    """
    Returns paginated customer list with profile summary and risk level if analyzed.
    Optional risk_filter: high | medium | low | analyzed
    Optional contract_filter: Month-to-month | One year | Two year
    """
    if page < 1:
        page = 1
    if page_size < 1 or page_size > 500:
        page_size = 100

    if risk_filter and risk_filter in VALID_RISK_FILTERS:
        candidate_ids = await get_customer_ids_by_risk(risk_filter)
    else:
        candidate_ids = await get_all_customer_ids()

    sem = asyncio.Semaphore(8)

    # Contract lives in the profile — pre-fetch all candidates to filter before paginating
    if contract_filter and contract_filter in VALID_CONTRACT_FILTERS:
        async def _contract(cid: str) -> tuple[str, str | None]:
            async with sem:
                profile = await get_profile(cid)
            return cid, (profile.get("contract") if profile else None)

        pairs = await asyncio.gather(*[_contract(cid) for cid in candidate_ids])
        candidate_ids = [cid for cid, c in pairs if c == contract_filter]

    total = len(candidate_ids)
    start = (page - 1) * page_size
    page_ids = candidate_ids[start : start + page_size]

    async def _row(cid: str):
        async with sem:
            profile = await get_profile(cid)
            risk = await get_risk_result(cid)
        return {
            "customer_id": cid,
            "contract": profile.get("contract") if profile else None,
            "tenure": profile.get("tenure") if profile else None,
            "monthly_charges": profile.get("monthly_charges") if profile else None,
            "risk_level": risk.get("risk_level") if risk else None,
        }

    rows = await asyncio.gather(*[_row(cid) for cid in page_ids])
    return {
        "customers": list(rows),
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": -(-total // page_size),  # ceiling division
    }


# ── Analyze-all SSE endpoint ─────────────────────────────────────────────────

@app.get("/api/customers/analyze-all/stream")
async def analyze_all_stream():
    """
    SSE stream: analyzes all customers that don't yet have a risk result.
    Emits: {"analyzed": N, "total": M, "current_id": "..."}
    Final: {"done": true, "analyzed": N, "total": M}
    """
    async def _stream():
        all_ids = await get_all_customer_ids()
        total = len(all_ids)

        # Check which customers still need analysis (semaphore keeps Redis connections sane)
        check_sem = asyncio.Semaphore(8)
        async def _needs_analysis(cid: str) -> bool:
            async with check_sem:
                return await get_risk_result(cid) is None

        flags = await asyncio.gather(*[_needs_analysis(cid) for cid in all_ids])
        pending = [cid for cid, needed in zip(all_ids, flags) if needed]

        analyzed = total - len(pending)

        # Emit initial progress so the bar renders immediately
        yield f"data: {json.dumps({'analyzed': analyzed, 'total': total, 'current_id': None})}\n\n"

        if not pending:
            yield f"data: {json.dumps({'done': True, 'analyzed': analyzed, 'total': total})}\n\n"
            return

        sem = asyncio.Semaphore(5)
        queue: asyncio.Queue[str] = asyncio.Queue()

        async def _run(cid: str) -> None:
            async with sem:
                await run_orchestrator(cid)
            await queue.put(cid)

        tasks = [asyncio.create_task(_run(cid)) for cid in pending]
        remaining = len(pending)

        while remaining > 0:
            cid = await queue.get()
            analyzed += 1
            remaining -= 1
            yield f"data: {json.dumps({'analyzed': analyzed, 'total': total, 'current_id': cid})}\n\n"

        await asyncio.gather(*tasks, return_exceptions=True)
        yield f"data: {json.dumps({'done': True, 'analyzed': analyzed, 'total': total})}\n\n"

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
