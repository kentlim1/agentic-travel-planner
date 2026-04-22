import json
import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv

load_dotenv()


def _get_client():
    return boto3.client("s3", region_name=os.getenv("AWS_REGION", "us-east-1"))


def _bucket() -> str:
    return os.getenv("S3_BUCKET", "")


def save_itinerary(state: dict) -> str | None:
    bucket = _bucket()
    if not bucket:
        print("[S3] S3_BUCKET not set, skipping itinerary save.")
        return None

    destination = (state.get("destination") or "unknown").replace(" ", "_").lower()
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    key = f"itineraries/{destination}/{timestamp}.json"

    record = {
        "saved_at": timestamp,
        "destination": state.get("destination"),
        "dates": state.get("dates"),
        "max_budget": state.get("max_budget"),
        "weather_forecast": state.get("weather_forecast"),
        "total_estimated_cost": state.get("total_estimated_cost"),
        "itinerary": state.get("current_itinerary", {}),
    }

    try:
        _get_client().put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(record, indent=2),
            ContentType="application/json",
        )
        print(f"[S3] Itinerary saved to s3://{bucket}/{key}")
        return key
    except ClientError as e:
        print(f"[S3] Error saving itinerary: {e}")
        return None


def list_itineraries(destination: str | None = None) -> list[dict]:
    bucket = _bucket()
    if not bucket:
        return []

    prefix = "itineraries/"
    if destination:
        prefix += destination.replace(" ", "_").lower() + "/"

    try:
        s3 = _get_client()
        paginator = s3.get_paginator("list_objects_v2")
        items = []
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                items.append({"key": obj["Key"], "saved_at": obj["LastModified"].isoformat()})
        return sorted(items, key=lambda x: x["saved_at"], reverse=True)
    except ClientError as e:
        print(f"[S3] Error listing itineraries: {e}")
        return []


def get_itinerary(key: str) -> dict | None:
    bucket = _bucket()
    if not bucket:
        return None

    try:
        response = _get_client().get_object(Bucket=bucket, Key=key)
        return json.loads(response["Body"].read())
    except ClientError as e:
        print(f"[S3] Error fetching itinerary: {e}")
        return None
