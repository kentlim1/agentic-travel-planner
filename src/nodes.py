import requests
import os
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from langchain_aws import ChatBedrock
from langchain_core.prompts import ChatPromptTemplate
from state import TravelState
from retriever import query_knowledge_base
from memory import load_preferences, save_preferences
from storage import save_itinerary

load_dotenv()

class ItineraryDraft(BaseModel):
    recommendation: str = Field(description="The specific name of what is being recommended. If the user asked for a hotel, this MUST be a hotel name. If they asked for an activity, this is the activity or venue name.")
    location_type: str = Field(description="Must be strictly 'indoor' or 'outdoor'")
    reasoning: str = Field(description="A short sentence explaining why this fits the user's budget and constraints")

class CostEstimate(BaseModel):
    estimated_cost: float = Field(description="Realistic total cost in USD for one person to do this activity, including entry fees, transport, and incidentals")

class TravelConstraints(BaseModel):
    destination: str = Field(description="The city and country the user wants to visit")
    max_budget: float = Field(description="The dollar amount the user states as their budget or price limit. Extract the number as-is — do NOT multiply by nights, days, or any duration. Phrases like 'less than $500', 'under $500', 'no more than $500', 'costs less than $500' all mean max_budget=500.0. If no price is mentioned, return 0.")
    dates: str = Field(description="The duration or specific dates of the trip")

llm = ChatBedrock(
    model_id=os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-3-5-sonnet-20241022-v2:0"),
    region_name=os.getenv("AWS_REGION", "us-east-1"),
    model_kwargs={"temperature": 0.7},
)
structured_llm = llm.with_structured_output(ItineraryDraft)

def load_memory(state: TravelState):
    preferences = load_preferences()
    if preferences.get("past_destinations"):
        print(f"[Memory] Welcome back! I remember you've visited: {', '.join(preferences['past_destinations'])}")
    else:
        print("[Memory] No previous preferences found. Starting fresh.")

    result = {"user_preferences": preferences}

    # Restore last known constraints if the state doesn't already have them
    # (i.e. this is a fresh Python session, not a follow-up turn in the same session)
    last = preferences.get("last_constraints", {})
    if last.get("destination") and state.get("destination") in (None, "Not set"):
        result["destination"] = last["destination"]
        print(f"[Memory] Restored last destination: {last['destination']}")
    if last.get("max_budget") and not state.get("max_budget"):
        result["max_budget"] = last["max_budget"]
    if last.get("dates") and state.get("dates") in (None, "Not set"):
        result["dates"] = last["dates"]

    return result


def save_memory(state: TravelState):
    preferences = state.get("user_preferences", {}).copy()
    destination = state.get("destination")
    itinerary = state.get("current_itinerary", {})
    activity = itinerary.get("recommendation")
    location_type = itinerary.get("location_type")

    if destination and destination not in preferences.get("past_destinations", []):
        preferences.setdefault("past_destinations", []).append(destination)

    if activity and activity not in preferences.get("past_activities", []):
        preferences.setdefault("past_activities", []).append(activity)

    preferences["last_constraints"] = {
        "destination": state.get("destination"),
        "max_budget": state.get("max_budget"),
        "dates": state.get("dates"),
    }

    save_preferences(preferences)
    print(f"[Memory] Preferences saved for future runs.")
    save_itinerary(state)
    return {"user_preferences": preferences}


def extract_constraints(state: TravelState):
    print("\n[LLM] Analyzing request with context...")
    
    # 1. Grab the latest message
    user_input = state["messages"][-1].content
    
    # 2. Grab existing values from the state (if they exist)
    current_budget = state.get("max_budget", 0.0)
    current_dest = state.get("destination", "Not set")
    current_dates = state.get("dates", "Not set")

    extractor_llm = llm.with_structured_output(TravelConstraints)
    
    # 3. Update the prompt to tell the LLM what we already know
    system_msg = (
        "You are a travel data assistant. Extract travel constraints from the user's message. "
        f"CURRENT TRIP: Destination: {current_dest}, Budget: ${current_budget}, Dates: {current_dates}. "
        "RULES: "
        "1. If the user explicitly names a NEW destination that differs from the current one, extract that new destination. "
        "2. If the user is adding details or refining the CURRENT trip (e.g. 'but I already went there', 'change the budget'), retain the current destination. "
        "3. Only retain budget and dates from the current trip if the user is refining the SAME destination. "
        "4. If a field is not mentioned and this appears to be a new destination, return 0 for budget and 'Not set' for dates. "
        "5. For budget: extract the number from ANY price phrasing — 'less than $500', 'under $500', 'no more than $500', '$500 per night' all mean max_budget=500. NEVER multiply by duration. If the user states a new price, ALWAYS use it even if a different budget exists from a previous request."
    )

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_msg),
        ("user", "{input}")
    ])

    chain = prompt | extractor_llm
    constraints = chain.invoke({"input": user_input})

    # 4. If destination changed, treat as a new trip — don't carry over old budget/dates
    destination_changed = (
        current_dest != "Not set"
        and constraints.destination.lower().strip() != current_dest.lower().strip()
    )

    if destination_changed:
        print(f"[Extractor] New destination detected ({current_dest} → {constraints.destination}). Resetting trip context.")
        final_budget = constraints.max_budget if constraints.max_budget > 0 else 0.0
        final_dates = constraints.dates if constraints.dates not in ("", "Not set") else "Not set"
    else:
        final_budget = constraints.max_budget if constraints.max_budget > 0 else current_budget
        final_dates = constraints.dates if constraints.dates not in ("", "Not set") else current_dates

    print(f"[Extracted]: {constraints.destination} | ${final_budget}")

    return {
        "destination": constraints.destination,
        "max_budget": final_budget,
        "dates": final_dates,
    }

def draft_itinerary(state: TravelState):
    print("\n[Local LLM Thinking...] Drafting a plan...")

    system_instructions = (
        "You are an expert travel agent with access to curated local knowledge. "
        "RULE 1 — HIGHEST PRIORITY: Always fulfill the user's explicit request first. "
        "If they ask for a hotel, recommend a specific hotel by name. No exceptions. "
        "If they ask for an activity, recommend a specific activity or venue. "
        "RULE 2: If LOCAL KNOWLEDGE snippets are provided, use them to inspire a creative, grounded response. "
        "You may reference or expand on them, but do not copy them verbatim. "
        "RULE 3: Past activities and preferences are secondary context only. Never let them override what the user explicitly asked for. "
        "CRITICAL INSTRUCTION: For 'location_type', you MUST output exactly the word 'indoor' or exactly the word 'outdoor'. "
        "Do NOT output the city name. Do NOT output anything else."
    )

    user_request = state["messages"][-1].content
    user_prompt = (
        f"User's request: {user_request}\n"
        f"Destination: {state.get('destination')}\nMax Budget: ${state.get('max_budget')}\n"
    )

    previous = state.get("current_itinerary", {}).get("recommendation")
    asking_for_nearby = any(word in user_request.lower() for word in ("near", "nearby", "close to", "next to", "around"))
    if previous:
        if asking_for_nearby:
            user_prompt += f"\nIMPORTANT: The user wants something geographically close to your previous recommendation: {previous}. Proximity is the top priority — only suggest places in the same neighbourhood or within easy walking distance."
        else:
            user_prompt += f"\nPreviously recommended in this conversation: {previous}"

    rag_query = f"{user_request} {state.get('destination', '')}"
    rag_hits = query_knowledge_base(rag_query, n_results=3)
    if rag_hits:
        print(f"[RAG] Found {len(rag_hits)} relevant local tips.")
        user_prompt += "\n--- LOCAL KNOWLEDGE (use only if geographically relevant to the request) ---"
        for hit in rag_hits:
            user_prompt += f"\n[{hit['source']} | {hit['location_type']}] {hit['text']}"
        user_prompt += "\n--- END LOCAL KNOWLEDGE ---\n"

    preferences = state.get("user_preferences", {})
    past_activities = preferences.get("past_activities", [])
    preferred_types = preferences.get("preferred_activity_types", [])
    avoided_types = preferences.get("avoided_activity_types", [])

    asking_for_hotel = any(word in user_request.lower() for word in ("hotel", "stay", "accommodation", "hostel", "airbnb", "resort"))
    if past_activities and not asking_for_hotel:
        user_prompt += f"\nNOTE: The user has already done these activities before, so suggest something different: {past_activities}"
    if preferred_types:
        user_prompt += f"\nThe user tends to prefer {preferred_types} activities."
    if avoided_types:
        user_prompt += f"\nThe user wants to avoid these activity types: {avoided_types}"

    if state.get("validation_errors") and len(state["validation_errors"]) > 0:
        print(f"[LLM Noticed Errors]: {state['validation_errors']}")
        user_prompt += f"\nWARNING: Your previous plan failed these checks: {state['validation_errors']}"
        user_prompt += "\nYou MUST suggest a different activity that solves these errors."

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_instructions),
        ("user", user_prompt)
    ])
    
    chain = prompt | structured_llm
    result = chain.invoke({}) 

    return {"current_itinerary": result.model_dump()}

def check_environment(state: TravelState):
    print("\n[API Call] Fetching live weather data...")
    city = state.get("destination", "Tokyo")
    api_key = os.getenv("OPENWEATHER_API_KEY")
    
    if not api_key:
        print("[Error]: API Key not found. Check your .env file!")
    url = f"http://api.openweathermap.org/data/2.5/weather?q={city}&appid={api_key}&units=imperial"
    
    real_weather = "Clear" # Default to Clear if API fails
    
    try:
        response = requests.get(url)
        if response.status_code == 200:
            data = response.json()
            real_weather = data['weather'][0]['main']
            print(f"[Live Data]: It is currently {real_weather} in {city}.")
        elif response.status_code == 401:
            print("[API Notice]: Key still activating. Defaulting to 'Clear' for now.")
        else:
            print(f"[API Error]: Status {response.status_code}")
    except Exception as e:
        print(f"[Network Error]: {e}")

    itinerary = state.get("current_itinerary", {})
    cost_llm = llm.with_structured_output(CostEstimate)
    cost_prompt = ChatPromptTemplate.from_messages([
        ("system", (
            "You are a travel cost estimator. Return a realistic total cost in USD for one person. "
            "CRITICAL: If the description says the place is free, free to enter, or has no entry fee, you MUST return 0.0. "
            "Hotels should reflect their actual nightly rate. Other paid activities should be conservative estimates."
        )),
        ("user", "Recommendation: {recommendation}\nDescription: {description}\nDestination: {destination}\nUser's max budget: ${max_budget}")
    ])
    cost_chain = cost_prompt | cost_llm
    recommendation = itinerary.get("recommendation", "general sightseeing")
    cost_result = cost_chain.invoke({
        "recommendation": recommendation,
        "description": itinerary.get("reasoning", ""),
        "destination": state.get("destination", city),
        "max_budget": state.get("max_budget", 0),
    })
    estimated_cost = cost_result.estimated_cost
    print(f"[Cost Estimate]: ${estimated_cost} for {recommendation}")

    return {
        "weather_forecast": real_weather,
        "total_estimated_cost": estimated_cost
    }

def validate_plan(state: TravelState):
    errors = []
    
    if state.get("total_estimated_cost", 0) > state.get("max_budget", 500):
        errors.append(f"Cost (${state.get('total_estimated_cost')}) exceeds budget.")
        
    weather = state.get("weather_forecast", "Clear")
    activity_type = state.get("current_itinerary", {}).get("location_type", "")
    
    if activity_type == "outdoor" and weather in ["Rain", "Drizzle", "Thunderstorm", "Snow"]:
        errors.append(f"It is currently {weather}. Please suggest an indoor activity instead.")
        
    return {"validation_errors": errors}