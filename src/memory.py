import json
import os

MEMORY_FILE = os.path.join(os.path.dirname(__file__), "..", "preferences.json")

DEFAULT_PREFERENCES = {
    "past_destinations": [],
    "avoided_activity_types": [],
    "preferred_activity_types": [],
    "past_activities": [],
    "notes": []
}

def load_preferences() -> dict:
    if not os.path.exists(MEMORY_FILE):
        return DEFAULT_PREFERENCES.copy()
    with open(MEMORY_FILE, "r") as f:
        return json.load(f)

def save_preferences(preferences: dict) -> None:
    with open(MEMORY_FILE, "w") as f:
        json.dump(preferences, f, indent=2)
