import hashlib
import math
from typing import List
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class EmbeddingService:
    """Generates dense vector embeddings with fallback for testing & offline usage."""

    def __init__(self):
        self.dim = settings.EMBEDDING_DIM
        self.provider = settings.EMBEDDING_PROVIDER
        self.model = settings.EMBEDDING_MODEL

    async def get_embedding(self, text: str) -> List[float]:
        """Generates embedding for a single text chunk."""
        results = await self.get_embeddings([text])
        return results[0] if results else [0.0] * self.dim

    async def get_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generates embeddings for multiple text chunks."""
        if not texts:
            return []

        # If OpenAI is configured and key is present, use OpenAI API
        if self.provider == "openai" and settings.OPENAI_API_KEY and not settings.OPENAI_API_KEY.startswith("test"):
            try:
                import openai
                client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
                resp = await client.embeddings.create(
                    input=texts,
                    model=self.model,
                )
                return [d.embedding for d in resp.data]
            except Exception as exc:
                logger.warning(f"OpenAI embedding API failed ({exc}). Falling back to deterministic hashing.")

        # High-performance deterministic unit-normalized vector for testing & offline operation
        return [self._hash_vector(t) for t in texts]

    def _hash_vector(self, text: str) -> List[float]:
        """Computes a 1536-dimensional unit-norm vector via murmur/sha256 feature hashing."""
        vector = [0.0] * self.dim
        tokens = text.lower().split()
        if not tokens:
            return vector

        for token in tokens:
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            # Map hash into dimensions
            for i in range(0, min(16, len(digest) - 1), 2):
                idx = int.from_bytes(digest[i : i + 2], "big") % self.dim
                sign = 1.0 if digest[i] % 2 == 0 else -1.0
                vector[idx] += sign

        # Normalize to unit length for accurate cosine similarity
        norm = math.sqrt(sum(x * x for x in vector))
        if norm > 0:
            vector = [round(x / norm, 6) for x in vector]

        return vector


embedding_service = EmbeddingService()
