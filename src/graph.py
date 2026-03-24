from langgraph.graph import StateGraph, START, END
from state import TravelState
from nodes import extract_constraints, draft_itinerary, check_environment, validate_plan, load_memory, save_memory

# 1. Initialize the Graph
workflow = StateGraph(TravelState)

# 2. Add the Nodes
workflow.add_edge(START, "memory_loader")
workflow.add_node("memory_loader", load_memory)
workflow.add_node("extractor", extract_constraints)
workflow.add_node("drafter", draft_itinerary)
workflow.add_node("checker", check_environment)
workflow.add_node("validator", validate_plan)
workflow.add_node("memory_saver", save_memory)

# 3. Define the standard flow
workflow.add_edge("memory_loader", "extractor")
workflow.add_edge("extractor", "drafter")
workflow.add_edge("drafter", "checker")
workflow.add_edge("checker", "validator")

# 4. The Self-Correction Loop
def routing_logic(state: TravelState):
    if len(state["validation_errors"]) > 0:
        return "re_draft"
    else:
        return "finish"

workflow.add_conditional_edges(
    "validator",
    routing_logic,
    {
        "re_draft": "drafter",
        "finish": "memory_saver"
    }
)
workflow.add_edge("memory_saver", END)

# Compile the graph
travel_agent = workflow.compile()

# Test

if __name__ == "__main__":
    print("--- AGENTIC TRAVEL PLANNER ---")
    print("(Type 'exit' or 'quit' to stop)\n")

    final_state = {}

    while True:
        user_input = input("You: ")

        if user_input.lower() in ["exit", "quit", "q"]:
            print("Goodbye!")
            break

        # Seed with constraints carried over from the previous turn
        initial_state = {
            "messages": [user_input],
            "destination": final_state.get("destination", "Not set"),
            "max_budget": final_state.get("max_budget", 0.0),
            "dates": final_state.get("dates", "Not set"),
            "current_itinerary": final_state.get("current_itinerary", {}),
            "validation_errors": [],
        }

        # We use a recursion limit of 15 to prevent infinite loops if the API is down
        config = {"recursion_limit": 15}

        try:
            # 1. Run the stream and capture the results as they arrive
            for event in travel_agent.stream(initial_state, config):
                for node_name, node_state in event.items():
                    # Update our final_state variable with the latest data from the nodes
                    final_state.update(node_state)
                    
                    # Print updates to the console for the user to see
                    if node_name == "drafter":
                        print(f"\n[Agent]: I'm thinking of {node_state['current_itinerary']['recommendation']}...")
                    elif node_name == "validator" and node_state.get("validation_errors"):
                        print(f"[Agent]: Wait, I found an issue: {node_state['validation_errors']}")
            
            itinerary = final_state.get("current_itinerary", {})
            
            print(f"\n--- FINAL PROPOSAL ---")
            print(f"Destination: {final_state.get('destination')}")
            print(f"Recommendation: {itinerary.get('recommendation')}")
            print(f"Reasoning: {itinerary.get('reasoning')}")
            print(f"Weather Check: {final_state.get('weather_forecast')}")
            print(f"Est. Cost: ${final_state.get('total_estimated_cost')}")
            print("-" * 30 + "\n")

        except Exception as e:
            print(f"\n[Error]: {e}")