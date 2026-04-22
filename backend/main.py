import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

SRC_DIR = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC_DIR))

from graph import travel_agent  # noqa: E402
from memory import MEMORY_FILE, load_preferences  # noqa: E402

app = FastAPI(title="Agentic Travel Planner API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TripCarry(BaseModel):
    destination: str | None = None
    max_budget: float = 0.0
    dates: str | None = None
    current_itinerary: dict = {}


class ChatRequest(BaseModel):
    message: str
    trip: TripCarry = TripCarry()


def _sanitize(obj: Any) -> Any:
    """Drop non-JSON-serializable values (e.g. LangChain message objects)."""
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items() if _json_safe(v)}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj if _json_safe(v)]
    return obj


def _json_safe(v: Any) -> bool:
    try:
        json.dumps(v, default=str)
        return True
    except (TypeError, ValueError):
        return False


def _build_reply(final: dict) -> str:
    itinerary = final.get("current_itinerary") or {}
    dest = final.get("destination") or "your destination"
    rec = itinerary.get("recommendation")
    errors = final.get("validation_errors") or []
    weather = final.get("weather_forecast")

    if not rec:
        return (
            "I'd love to help plan your trip! Could you tell me your destination, "
            "your budget (e.g. $500), and when you're planning to go?"
        )
    if errors:
        return (
            f"I ran into a constraint issue in **{dest}**: {'; '.join(errors)} "
            f"You can see the trace in the proposal panel."
        )
    loc_type = itinerary.get("location_type", "")
    bad_weather = weather in {"Rain", "Drizzle", "Thunderstorm", "Snow"}
    reply = f"I've found something for you in **{dest}**: **{rec}**."
    if bad_weather and loc_type == "indoor":
        reply += f" The weather in {dest} is {weather}, so I chose an indoor option."
    reply += " Check the proposal panel for full details."
    return reply


@app.post("/api/chat")
async def chat(req: ChatRequest):
    async def stream():
        initial_state = {
            "messages": [req.message],
            "destination": req.trip.destination or "Not set",
            "max_budget": req.trip.max_budget or 0.0,
            "dates": req.trip.dates or "Not set",
            "current_itinerary": req.trip.current_itinerary or {},
            "validation_errors": [],
        }
        final_state: dict = {}
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        SENTINEL = object()

        def run_graph():
            try:
                for event in travel_agent.stream(initial_state, {"recursion_limit": 15}):
                    for node_name, node_state in event.items():
                        if isinstance(node_state, dict):
                            final_state.update(node_state)
                        loop.call_soon_threadsafe(
                            queue.put_nowait,
                            {
                                "type": "stage",
                                "name": node_name,
                                "state": _sanitize(node_state or {}),
                            },
                        )
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {
                        "type": "final",
                        "reply": _build_reply(final_state),
                        "destination": final_state.get("destination"),
                        "max_budget": final_state.get("max_budget"),
                        "dates": final_state.get("dates"),
                        "current_itinerary": _sanitize(final_state.get("current_itinerary") or {}),
                        "weather_forecast": final_state.get("weather_forecast"),
                        "total_estimated_cost": final_state.get("total_estimated_cost"),
                        "validation_errors": final_state.get("validation_errors") or [],
                        "memory": _sanitize(final_state.get("user_preferences") or {}),
                    },
                )
            except Exception as e:  # surface errors to the client
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {"type": "error", "message": f"{type(e).__name__}: {e}"},
                )
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, SENTINEL)

        asyncio.create_task(asyncio.to_thread(run_graph))

        while True:
            item = await queue.get()
            if item is SENTINEL:
                break
            yield json.dumps(item, default=str) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@app.get("/api/memory")
def get_memory():
    return load_preferences()


@app.post("/api/memory/clear")
def clear_memory():
    if os.path.exists(MEMORY_FILE):
        os.remove(MEMORY_FILE)
    return {"ok": True}


@app.get("/api/health")
def health():
    return {"ok": True}
