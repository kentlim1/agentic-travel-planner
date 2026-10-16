from typing import TypedDict, List, Annotated
from langgraph.graph.message import add_messages

class TravelState(TypedDict):
    messages: Annotated[list, add_messages]
    max_budget: float
    destination: str
    dates: str
    last_request: str
    current_itinerary: dict
    weather_forecast: dict
    total_estimated_cost: float
    validation_errors: List[str]
    user_preferences: dict