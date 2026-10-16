import os
import chromadb
from dotenv import load_dotenv
from langchain_aws import BedrockEmbeddings

load_dotenv()

# 1. Initialize the local ChromaDB client
_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "travel_db")
client = chromadb.PersistentClient(path=_DB_PATH)
collection = client.get_or_create_collection(name="niche_travel_tips")

# 2. Define the Embedding Model (calls Bedrock; must match retriever.py's model)
embed_model = BedrockEmbeddings(
    model_id=os.getenv("TITAN_EMBED_MODEL_ID", "amazon.titan-embed-text-v2:0"),
    region_name=os.getenv("AWS_REGION", "us-east-1"),
)

# 3. Add some "proprietary" knowledge
knowledge_base = [
    {
        "name": "God's Own Junkyard",
        "text": "The 'God's Own Junkyard' in London is a neon-lit warehouse of vintage signs. It is indoors and free to enter.",
        "source": "local_blog",
        "location_type": "indoor",
    },
    {
        "name": "Rules Restaurant",
        "text": "Rules Restaurant is the oldest in London, famous for its game and classic British decor. It is high-end and requires a reservation.",
        "source": "local_blog",
        "location_type": "indoor",
    },
    {
        "name": "Kyoto Garden",
        "text": "The Kyoto Garden in Holland Park is a hidden Japanese gem in London. It is outdoors and very quiet compared to major parks.",
        "source": "local_blog",
        "location_type": "outdoor",
    },
    {
        "name": "Barbican Conservatory",
        "text": "The Barbican Conservatory is a massive indoor rainforest in London, but it's only open on select days and requires a free booking.",
        "source": "local_blog",
        "location_type": "indoor",
    },
    {
        "name": "Lola's By MFK",
        "text": "Lola's By MFK is a lively brunch spot in Anaheim known for hearty Filipino-American plates and strong coffee. It gets busy on weekends, so arrive early or expect a wait.",
        "source": "personal_notes",
        "location_type": "indoor",
    },
    {
        "name": "Manila Inasal",
        "text": "Manila Inasal in Downtown Los Angeles serves classic Filipino grilled chicken and unlimited rice in a casual dining room. It's a local favorite, with reservations recommended on weekend nights.",
        "source": "personal_notes",
        "location_type": "indoor",
    },
    {
        "name": "Bake House Manila",
        "text": "Bake House Manila is a neighborhood bakery known for fresh pastries, sourdough, and espresso drinks. It's a quick, affordable stop for breakfast or a coffee break.",
        "source": "personal_notes",
        "location_type": "indoor",
    },
    {
        "name": "Mendokoro Ramenba",
        "text": "Mendokoro Ramenba in BGC serves rich, slow-simmered tonkotsu ramen in a cozy indoor izakaya setting. Lines form at peak hours, so an early dinner avoids the wait.",
        "source": "personal_notes",
        "location_type": "indoor",
    },
    {
        "name": "Fowlbread",
        "text": "Fowlbread is a Manila restaurant centered on roast chicken and fresh-baked bread, served in a warm, casual dining room. It's a solid pick for a relaxed dinner.",
        "source": "personal_notes",
        "location_type": "indoor",
    },
    {
        "name": "Kodawari",
        "text": "Kodawari in BGC is an intimate indoor restaurant specializing in Japanese comfort dishes. The small space fills up fast, so booking ahead is worthwhile.",
        "source": "personal_notes",
        "location_type": "indoor",
    },
    {
        "name": "The Fat Seed Cafe + Roastery",
        "text": "The Fat Seed Cafe + Roastery in BGC roasts its own beans and serves all-day brunch in a plant-filled, airy space. It has both indoor seating and a shaded outdoor patio.",
        "source": "personal_notes",
        "location_type": "indoor",
    },
    {
        "name": "Auro Chocolate Cafe",
        "text": "Auro Chocolate Cafe's BGC flagship showcases Philippine single-origin chocolate in drinks, pastries, and desserts. The indoor cafe also sells bars and gifts to take home.",
        "source": "personal_notes",
        "location_type": "indoor",
    },
    {
        "name": "J.Co Donuts and Coffee",
        "text": "J.Co Donuts and Coffee at Park Triangle in BGC is a casual indoor stop for glazed donuts and espresso drinks. It's quick and affordable, good for a snack between activities.",
        "source": "personal_notes",
        "location_type": "indoor",
    },
    {
        "name": "Manam",
        "text": "Manam at Net Park in BGC serves modern Filipino comfort food in a stylish indoor dining room. It's popular for group dinners, so reservations are recommended.",
        "source": "personal_notes",
        "location_type": "indoor",
    },
]

# 4. Store the data
for i, entry in enumerate(knowledge_base):
    vector = embed_model.embed_query(entry["text"])
    collection.upsert(
        ids=[f"id_{i}"],
        embeddings=[vector],
        documents=[entry["text"]],
        metadatas=[{"name": entry["name"], "source": entry["source"], "location_type": entry["location_type"]}]
    )

print("Knowledge base created and stored in ./travel_db")