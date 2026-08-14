import os
import sys
import types
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC_DIR))

# `nodes.py` imports `retriever`, which constructs a HuggingFaceEmbeddings
# model at import time (downloads weights from HF Hub). Stub it out so the
# test suite stays hermetic and fast.
if "retriever" not in sys.modules:
    fake_retriever = types.ModuleType("retriever")
    fake_retriever.query_knowledge_base = lambda *args, **kwargs: []
    sys.modules["retriever"] = fake_retriever

# Force fake AWS credentials so any accidental, unmocked boto3/Bedrock call
# fails fast on auth instead of silently reaching real AWS.
os.environ["AWS_ACCESS_KEY_ID"] = "testing"
os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
os.environ["AWS_SESSION_TOKEN"] = "testing"
os.environ["AWS_DEFAULT_REGION"] = "us-east-1"
os.environ["AWS_REGION"] = "us-east-1"
