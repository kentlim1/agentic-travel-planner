from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableLambda

import nodes


def test_validate_plan_flags_over_budget_and_bad_weather():
    state = {
        "total_estimated_cost": 600.0,
        "max_budget": 500.0,
        "weather_forecast": "Rain",
        "current_itinerary": {"location_type": "outdoor"},
    }

    result = nodes.validate_plan(state)

    errors = result["validation_errors"]
    assert any("exceeds budget" in e for e in errors)
    assert any("indoor activity" in e for e in errors)


def test_validate_plan_passes_when_within_budget_and_clear():
    state = {
        "total_estimated_cost": 100.0,
        "max_budget": 500.0,
        "weather_forecast": "Clear",
        "current_itinerary": {"location_type": "outdoor"},
    }

    result = nodes.validate_plan(state)

    assert result["validation_errors"] == []


def test_extract_constraints_uses_mocked_bedrock(monkeypatch):
    # Never call real Bedrock: swap `with_structured_output` for a stub
    # Runnable that returns a canned result.
    fake_result = nodes.TravelConstraints(
        destination="Tokyo", max_budget=500.0, dates="5 days in July"
    )
    monkeypatch.setattr(
        type(nodes.llm),
        "with_structured_output",
        lambda self, schema: RunnableLambda(lambda _: fake_result),
    )

    state = {
        "messages": [HumanMessage(content="Plan a $500 trip to Tokyo for 5 days in July")],
        "max_budget": 0.0,
        "destination": "Not set",
        "dates": "Not set",
    }

    result = nodes.extract_constraints(state)

    assert result["destination"] == "Tokyo"
    assert result["max_budget"] == 500.0
    assert result["dates"] == "5 days in July"
