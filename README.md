# Agentic Travel Planner

A conversational AI travel planner built with LangGraph and a local Ollama LLM. The agent uses a self-correcting graph to recommend activities and accommodations, retrieves curated local tips from a vector database, validates recommendations against live weather data and budget constraints, and remembers your preferences between sessions.

---

## Architecture

The agent is a directed graph with a built-in self-correction loop:

```
START → memory_loader → extractor → drafter → checker → validator
                                                              │
                                          ┌───── re_draft ←──┘
                                          │
                                       drafter
                                          │
                                       checker
                                          │
                                       validator ──── finish ───→ memory_saver → END
```

### Nodes

| Node | File | Responsibility |
|---|---|---|
| `memory_loader` | `nodes.py` | Loads `preferences.json` into state. Restores the last known destination, budget, and dates for returning users. |
| `extractor` | `nodes.py` | Uses a structured LLM call to parse the user's message into `destination`, `max_budget`, and `dates`. Detects topic switches (e.g. London → Tokyo) and resets stale constraints automatically. |
| `drafter` | `nodes.py` | Queries ChromaDB for the top 3 semantically relevant local tips, then calls the LLM with that context injected alongside the user's past activities, preferences, and previous recommendation. |
| `checker` | `nodes.py` | Calls the OpenWeatherMap API for live weather. Uses a second LLM call to estimate a realistic cost for the recommendation. |
| `validator` | `nodes.py` | Compares estimated cost against `max_budget` and checks whether an outdoor recommendation clashes with bad weather. Appends errors to `validation_errors`. |
| `memory_saver` | `nodes.py` | Persists the destination, recommendation, and constraints back to `preferences.json` for future sessions. |

### Self-Correction Loop

After `validator` runs, the graph's conditional edge checks `validation_errors`:

- **Errors found** → routes back to `drafter`, which receives the errors in its prompt and must suggest a different recommendation that resolves them.
- **No errors** → routes to `memory_saver` and ends.

A recursion limit of 15 prevents infinite loops if the model gets stuck.

---

## RAG: Local Knowledge Base

The agent uses a local ChromaDB vector store to surface curated "hidden gem" tips before calling the LLM. This grounds responses in real, specific knowledge rather than generic LLM output.

### How it works

1. **Ingest** (`ingest.py`) — run once to embed each tip and store it in ChromaDB at `./travel_db`. Each document has two metadata fields:
   - `source` — where the tip came from (e.g. `local_blog`)
   - `location_type` — `indoor` or `outdoor`

2. **Retrieve** (`retriever.py`) — at draft time, the user's request + destination are embedded and queried against the collection. The top 3 matches are returned as `{text, source, location_type}` dicts.

3. **Inject** (`nodes.py`) — the hits are formatted into a `--- LOCAL KNOWLEDGE ---` block and prepended to the LLM prompt. The LLM is instructed to use them as inspiration, not copy them verbatim.

### Adding your own tips

Add entries to the `knowledge_base` list in `ingest.py`:

```python
{
    "text": "Yanaka Ginza in Tokyo is a preserved Showa-era shopping street, largely untouched by modern development.",
    "source": "local_blog",
    "location_type": "outdoor",
},
```

Then re-run `python ingest.py` to rebuild the collection.

---

## Persistent Memory

Preferences are stored in `preferences.json` and survive between Python sessions.

```json
{
  "past_destinations": ["London", "Tokyo"],
  "past_activities": ["Visit the Sky Garden in London"],
  "preferred_activity_types": ["indoor"],
  "avoided_activity_types": [],
  "last_constraints": {
    "destination": "Tokyo",
    "max_budget": 500.0,
    "dates": "Oct 12-14"
  },
  "notes": []
}
```

What gets remembered:
- **Past destinations** — shown as a greeting on subsequent runs
- **Past activities/hotels** — injected into the drafter's prompt so it avoids repeating recommendations
- **Last constraints** — destination, budget, and dates are restored at the start of a new session so the user doesn't have to repeat themselves
- **Preferred/avoided activity types** — used to bias future drafts (only when not overridden by an explicit request)

---

## Project Structure

```
travel-agent/
├── graph.py          # LangGraph workflow definition and CLI entry point
├── nodes.py          # All node functions and Pydantic models
├── state.py          # TravelState TypedDict schema
├── memory.py         # load_preferences / save_preferences helpers
├── retriever.py      # ChromaDB client and query_knowledge_base helper
├── ingest.py         # One-time script to populate the vector store
├── travel_db/        # Persistent ChromaDB storage (auto-created by ingest.py)
└── preferences.json  # Persisted user preferences (auto-created)
```

## Setup

**Requirements**

- Python 3.10+
- [Ollama](https://ollama.com) running locally with `llama3.1` pulled
- An [OpenWeatherMap](https://openweathermap.org/api) API key

**Install dependencies**

```bash
pip install langgraph langchain-ollama langchain-core langchain-huggingface pydantic requests chromadb sentence-transformers
```

**Add your OpenWeatherMap API key**

In `nodes.py`, replace the placeholder in `check_environment`:

```python
api_key = "YOUR_OPENWEATHER_API_KEY"
```

**Populate the knowledge base** (once, before first run)

```bash
python ingest.py
```

**Run**

```bash
python graph.py
```

---

## Example Session

```
--- AGENTIC TRAVEL PLANNER ---
(Type 'exit' or 'quit' to stop)

You: I want to visit Tokyo for $500. I love history but hate the rain.

[Memory] No previous preferences found. Starting fresh.
[LLM] Analyzing request with context...
[Extracted]: Tokyo | $500.0
[Local LLM Thinking...] Drafting a plan...
[RAG] Found 3 relevant local tips.
[Agent]: I'm thinking of Tokyo National Museum...
[API Call] Fetching live weather data...
[Cost Estimate]: $12.0 for Tokyo National Museum
[Memory] Preferences saved for future runs.

--- FINAL PROPOSAL ---
Destination: Tokyo
Recommendation: Tokyo National Museum
Reasoning: Fits the budget and avoids rain — largest museum in Japan covering 110,000 artefacts.
Weather Check: Clear
Est. Cost: $12.0
------------------------------

You: Can you recommend something near that museum?

[Memory] Welcome back! I remember you've visited: Tokyo
...
Previously recommended in this conversation: Tokyo National Museum
```
