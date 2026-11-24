import time
from typing import Any, Dict, List
from app.core.database import db
from app.core.logging import get_logger
from app.graph.events import emit_event
from app.graph.state import ReviewState
from app.services.chunking import chunker
from app.services.embeddings import embedding_service

logger = get_logger(__name__)


async def context_retriever_node(state: ReviewState) -> Dict[str, Any]:
    """
    Node 1: Context Retriever.
    Indexes repo files if not already cached for commit SHA,
    extracts modified symbols and dependencies, and retrieves top-k relevant context chunks.
    """
    start_time = time.perf_counter()
    review_id = state.get("review_id", "")
    repo = state.get("repo", "")
    head_sha = state.get("head_sha", "")
    diff = state.get("diff", "")
    file_contents = state.get("file_contents", {})

    await emit_event(
        state,
        event_type="node_started",
        data={"message": "Initializing Context Retriever agent", "repo": repo, "head_sha": head_sha[:7] if head_sha else ""},
        agent="context_retriever",
    )

    retrieved_chunks: List[Dict[str, Any]] = []
    tokens_in = 0
    tokens_out = 0

    try:
        # Step 1: Check if commit is already indexed
        already_indexed = await db.has_indexed_commit(repo, head_sha)
        if not already_indexed:
            await emit_event(
                state,
                event_type="reasoning",
                data={"step": f"Indexing files for commit {head_sha[:7] if head_sha else 'head'} into vector database"},
                agent="context_retriever",
            )

            # Chunk files
            all_chunks: List[Dict[str, Any]] = []
            for path, content in file_contents.items():
                file_chunks = chunker.chunk_file(repo, head_sha, path, content)
                all_chunks.extend(file_chunks)

            # Generate embeddings and store if chunks exist
            if all_chunks:
                texts = [c["content"] for c in all_chunks]
                embeddings = await embedding_service.get_embeddings(texts)
                for chunk, emb in zip(all_chunks, embeddings):
                    chunk["embedding"] = emb

                await db.store_repo_chunks(all_chunks)
                await emit_event(
                    state,
                    event_type="tool_call",
                    data={"tool": "store_chunks", "count": len(all_chunks)},
                    agent="context_retriever",
                )
        else:
            await emit_event(
                state,
                event_type="reasoning",
                data={"step": f"Commit {head_sha[:7] if head_sha else ''} already indexed in vector store. Skipping re-indexing."},
                agent="context_retriever",
            )

        # Step 2: Extract symbols and imports from diff for dependency tracing
        symbols, imports = chunker.extract_symbols_and_imports(diff)
        await emit_event(
            state,
            event_type="reasoning",
            data={
                "step": f"Extracted {len(symbols)} modified symbols and {len(imports)} dependency imports from diff",
                "symbols_sample": list(symbols)[:5],
                "imports_sample": list(imports)[:5],
            },
            agent="context_retriever",
        )

        # Step 3: Semantic retrieval
        query_text = f"symbols: {' '.join(list(symbols)[:10])} imports: {' '.join(list(imports)[:10])}"
        query_vec = await embedding_service.get_embedding(query_text)

        await emit_event(
            state,
            event_type="tool_call",
            data={"tool": "vector_similarity_search", "query_symbols": list(symbols)[:5]},
            agent="context_retriever",
        )

        raw_results = await db.similarity_search(repo, head_sha, query_vec, top_k=6)
        for r in raw_results:
            retrieved_chunks.append({
                "path": r.get("path"),
                "chunk_index": r.get("chunk_index"),
                "content": r.get("content"),
                "similarity": r.get("similarity", 0.0),
            })

    except Exception as exc:
        logger.error(f"Error in context_retriever_node: {exc}", exc_info=True)
        state.setdefault("errors", []).append(f"ContextRetrieverError: {str(exc)}")
        await emit_event(
            state,
            event_type="error",
            data={"error": str(exc)},
            agent="context_retriever",
        )

    latency_ms = int((time.perf_counter() - start_time) * 1000)

    # Record agent metrics
    metrics = state.setdefault("metrics", {})
    metrics["context_retriever"] = {
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "latency_ms": latency_ms,
        "chunks_retrieved": len(retrieved_chunks),
    }

    if review_id:
        await db.save_agent_run(
            review_id=review_id,
            agent_name="context_retriever",
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
            status="completed",
        )

    await emit_event(
        state,
        event_type="node_finished",
        data={"latency_ms": latency_ms, "chunks_retrieved": len(retrieved_chunks)},
        agent="context_retriever",
    )

    return {
        "context_chunks": retrieved_chunks,
        "events": state.get("events", []),
        "metrics": metrics,
    }
