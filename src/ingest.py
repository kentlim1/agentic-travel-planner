import os
import chromadb
from langchain_huggingface import HuggingFaceEmbeddings

# 1. Initialize the local ChromaDB client
_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "travel_db")
client = chromadb.PersistentClient(path=_DB_PATH)
collection = client.get_or_create_collection(name="niche_travel_tips")

# 2. Define the Embedding Model (Runs locally on your CPU)
embed_model = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

# 3. Add some "proprietary" knowledge 
# In a real project, you'd scrape blogs or use PDFs here
knowledge_base = [
    {
        "text": "The 'God's Own Junkyard' in London is a neon-lit warehouse of vintage signs. It is indoors and free to enter.",
        "source": "local_blog",
        "location_type": "indoor",
    },
    {
        "text": "Rules Restaurant is the oldest in London, famous for its game and classic British decor. It is high-end and requires a reservation.",
        "source": "local_blog",
        "location_type": "indoor",
    },
    {
        "text": "The Kyoto Garden in Holland Park is a hidden Japanese gem in London. It is outdoors and very quiet compared to major parks.",
        "source": "local_blog",
        "location_type": "outdoor",
    },
    {
        "text": "The Barbican Conservatory is a massive indoor rainforest in London, but it's only open on select days and requires a free booking.",
        "source": "local_blog",
        "location_type": "indoor",
    },
]

# 4. Store the data
for i, entry in enumerate(knowledge_base):
    vector = embed_model.embed_query(entry["text"])
    collection.add(
        ids=[f"id_{i}"],
        embeddings=[vector],
        documents=[entry["text"]],
        metadatas=[{"source": entry["source"], "location_type": entry["location_type"]}]
    )

print("Knowledge base created and stored in ./travel_db")