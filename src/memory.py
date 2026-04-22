import os
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv

load_dotenv()

USER_ID = "default"

DEFAULT_PREFERENCES = {
    "past_destinations": [],
    "avoided_activity_types": [],
    "preferred_activity_types": [],
    "past_activities": [],
    "notes": [],
}


def _get_table():
    dynamodb = boto3.resource("dynamodb", region_name=os.getenv("AWS_REGION", "us-east-1"))
    return dynamodb.Table(os.getenv("DYNAMODB_TABLE", "travel-agent-preferences"))


def _to_dynamodb(obj):
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _to_dynamodb(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_dynamodb(v) for v in obj]
    return obj


def _from_dynamodb(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, dict):
        return {k: _from_dynamodb(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_from_dynamodb(v) for v in obj]
    return obj


def load_preferences() -> dict:
    try:
        table = _get_table()
        response = table.get_item(Key={"user_id": USER_ID})
        item = response.get("Item")
        if not item:
            return DEFAULT_PREFERENCES.copy()
        item.pop("user_id", None)
        return {**DEFAULT_PREFERENCES.copy(), **_from_dynamodb(item)}
    except ClientError as e:
        print(f"[DynamoDB] Error loading preferences: {e}")
        return DEFAULT_PREFERENCES.copy()


def save_preferences(preferences: dict) -> None:
    try:
        table = _get_table()
        table.put_item(Item={"user_id": USER_ID, **_to_dynamodb(preferences)})
    except ClientError as e:
        print(f"[DynamoDB] Error saving preferences: {e}")


def clear_preferences() -> None:
    try:
        table = _get_table()
        table.delete_item(Key={"user_id": USER_ID})
    except ClientError as e:
        print(f"[DynamoDB] Error clearing preferences: {e}")
