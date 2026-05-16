"""Load WA_Fn-UseC_-Telco-Customer-Churn.csv into Redis."""

import asyncio
import json
import os
import re
import sys

import pandas as pd
import redis.asyncio as aioredis
from dotenv import load_dotenv

load_dotenv()

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
CSV_PATH = os.path.join(os.path.dirname(__file__), "data", "WA_Fn-UseC_-Telco-Customer-Churn.csv")


def to_snake_case(name: str) -> str:
    # Special-case the primary key column before generic conversion
    if name.lower() == "customerid":
        return "customer_id"
    # Handle camelCase and PascalCase
    s1 = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", name)
    s2 = re.sub(r"([a-z\d])([A-Z])", r"\1_\2", s1)
    return s2.lower().replace(" ", "_").replace("-", "_")


async def load():
    df = pd.read_csv(CSV_PATH)
    df = df.head(1000)

    # Normalize column names
    df.columns = [to_snake_case(c) for c in df.columns]

    # Strip whitespace from string columns
    for col in df.select_dtypes(include="object").columns:
        df[col] = df[col].str.strip()

    # Convert TotalCharges to numeric (some rows have spaces)
    if "total_charges" in df.columns:
        df["total_charges"] = pd.to_numeric(df["total_charges"], errors="coerce").fillna(0.0)

    pool = aioredis.ConnectionPool.from_url(REDIS_URL, max_connections=20, decode_responses=True)
    r = aioredis.Redis(connection_pool=pool)

    pipe = r.pipeline()
    count = 0
    for _, row in df.iterrows():
        record = row.to_dict()
        # customerID → to_snake_case → customer_id (handled by special case above)
        customer_id = record.get("customer_id")
        if not customer_id:
            continue
        # Normalise the key name in the record
        record["customer_id"] = customer_id
        key = f"customer:{customer_id}:profile"
        pipe.set(key, json.dumps(record))
        count += 1

    await pipe.execute()
    await r.aclose()
    await pool.aclose()
    print(f"Loaded {count} customers into Redis.")


if __name__ == "__main__":
    asyncio.run(load())
