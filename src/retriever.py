import os
import chromadb
from langchain_huggingface import HuggingFaceEmbeddings

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "travel_db")
_client = chromadb.PersistentClient(path=_DB_PATH)
_collection = _client.get_or_create_collection(name="niche_travel_tips")
_embed_model = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")


def query_knowledge_base(query: str, n_results: int = 3) -> list[dict]:
    """
    Returns the top n_results matching documents from ChromaDB.
    Each result is a dict with 'text', 'source', and 'location_type'.
    Returns an empty list if the collection has no documents.
    """
    if _collection.count() == 0:
        return []

    vector = _embed_model.embed_query(query)
    results = _collection.query(
        query_embeddings=[vector],
        n_results=min(n_results, _collection.count()),
        include=["documents", "metadatas"],
    )

    hits = []
    for doc, meta in zip(results["documents"][0], results["metadatas"][0]):
        hits.append({
            "text": doc,
            "source": meta.get("source", "unknown"),
            "location_type": meta.get("location_type", "unknown"),
        })
    return hits
