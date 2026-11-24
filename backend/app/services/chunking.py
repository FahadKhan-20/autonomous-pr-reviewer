import ast
import re
from typing import Any, Dict, List, Set, Tuple
from app.core.logging import get_logger

logger = get_logger(__name__)


class CodeChunker:
    """Language-aware semantic code chunker with fallback line-windowing."""

    def __init__(self, target_chunk_size: int = 60, overlap_lines: int = 10):
        self.target_chunk_size = target_chunk_size
        self.overlap_lines = overlap_lines

    def chunk_file(
        self,
        repo: str,
        commit_sha: str,
        path: str,
        content: str,
    ) -> List[Dict[str, Any]]:
        """Splits a file's content into semantic chunks."""
        if not content.strip():
            return []

        lower_path = path.lower()
        if lower_path.endswith(".py"):
            return self._chunk_python(repo, commit_sha, path, content)
        elif lower_path.endswith((".js", ".jsx", ".ts", ".tsx")):
            return self._chunk_javascript(repo, commit_sha, path, content)
        else:
            return self._chunk_generic(repo, commit_sha, path, content)

    def _chunk_python(
        self,
        repo: str,
        commit_sha: str,
        path: str,
        content: str,
    ) -> List[Dict[str, Any]]:
        """Parses Python AST to extract top-level and class-level functions and classes."""
        chunks: List[Dict[str, Any]] = []
        lines = content.splitlines(keepends=True)
        try:
            tree = ast.parse(content, filename=path)
            nodes = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))]

            if not nodes:
                return self._chunk_generic(repo, commit_sha, path, content, language="python")

            chunk_idx = 0
            for node in nodes:
                start_line = getattr(node, "lineno", 1) - 1
                end_line = getattr(node, "end_lineno", len(lines))
                chunk_code = "".join(lines[start_line:end_line])

                if chunk_code.strip():
                    chunks.append({
                        "repo": repo,
                        "commit_sha": commit_sha,
                        "path": path,
                        "chunk_index": chunk_idx,
                        "content": chunk_code,
                        "language": "python",
                        "start_line": start_line + 1,
                        "end_line": end_line,
                        "symbol": getattr(node, "name", "anonymous"),
                    })
                    chunk_idx += 1

            return chunks
        except Exception as exc:
            logger.debug(f"AST parsing failed for {path} ({exc}); falling back to line chunking.")
            return self._chunk_generic(repo, commit_sha, path, content, language="python")

    def _chunk_javascript(
        self,
        repo: str,
        commit_sha: str,
        path: str,
        content: str,
    ) -> List[Dict[str, Any]]:
        """Chunks JS/TS files by recognizing function, class, and export boundaries."""
        chunks: List[Dict[str, Any]] = []
        lines = content.splitlines(keepends=True)

        # Regex patterns for function, class, and exported component headers
        pattern = re.compile(
            r"^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|class|const|let|var)\s+([a-zA-Z0-9_$]+)"
        )

        chunk_idx = 0
        current_chunk_lines: List[str] = []
        current_symbol = "preamble"
        start_line = 1

        for i, line in enumerate(lines, start=1):
            match = pattern.match(line.strip())
            if match and len(current_chunk_lines) >= 15:
                # Flush existing chunk
                chunk_text = "".join(current_chunk_lines)
                if chunk_text.strip():
                    chunks.append({
                        "repo": repo,
                        "commit_sha": commit_sha,
                        "path": path,
                        "chunk_index": chunk_idx,
                        "content": chunk_text,
                        "language": "typescript" if path.endswith((".ts", ".tsx")) else "javascript",
                        "start_line": start_line,
                        "end_line": i - 1,
                        "symbol": current_symbol,
                    })
                    chunk_idx += 1
                current_chunk_lines = [line]
                current_symbol = match.group(1)
                start_line = i
            else:
                current_chunk_lines.append(line)

        # Final chunk
        if current_chunk_lines:
            chunk_text = "".join(current_chunk_lines)
            if chunk_text.strip():
                chunks.append({
                    "repo": repo,
                    "commit_sha": commit_sha,
                    "path": path,
                    "chunk_index": chunk_idx,
                    "content": chunk_text,
                    "language": "typescript" if path.endswith((".ts", ".tsx")) else "javascript",
                    "start_line": start_line,
                    "end_line": len(lines),
                    "symbol": current_symbol,
                })

        return chunks if chunks else self._chunk_generic(repo, commit_sha, path, content, language="javascript")

    def _chunk_generic(
        self,
        repo: str,
        commit_sha: str,
        path: str,
        content: str,
        language: str = "text",
    ) -> List[Dict[str, Any]]:
        """Window-based chunking with line overlap."""
        chunks: List[Dict[str, Any]] = []
        lines = content.splitlines(keepends=True)
        total_lines = len(lines)

        if total_lines == 0:
            return []

        step = max(1, self.target_chunk_size - self.overlap_lines)
        chunk_idx = 0

        for i in range(0, total_lines, step):
            window = lines[i : i + self.target_chunk_size]
            chunk_code = "".join(window)
            if chunk_code.strip():
                chunks.append({
                    "repo": repo,
                    "commit_sha": commit_sha,
                    "path": path,
                    "chunk_index": chunk_idx,
                    "content": chunk_code,
                    "language": language,
                    "start_line": i + 1,
                    "end_line": min(i + self.target_chunk_size, total_lines),
                    "symbol": f"chunk_{chunk_idx}",
                })
                chunk_idx += 1

        return chunks

    def extract_symbols_and_imports(self, diff_text: str) -> Tuple[Set[str], Set[str]]:
        """
        Extracts referenced function/class names and imported modules from added/modified diff lines
        to support dependency-guided context retrieval.
        """
        symbols: Set[str] = set()
        imports: Set[str] = set()

        # Regex for Python/JS imports
        py_import_pattern = re.compile(r"^\+\s*(?:from\s+([a-zA-Z0-9_\.]+)\s+import|import\s+([a-zA-Z0-9_\.]+))")
        js_import_pattern = re.compile(r"^\+\s*import\s+.*?from\s+['\"]([^'\"]+)['\"]")

        # Regex for function and call symbols
        symbol_pattern = re.compile(r"\b([a-zA-Z_][a-zA-Z0-9_]{3,})\b")

        for line in diff_text.splitlines():
            if not line.startswith("+") or line.startswith("+++"):
                continue

            # Check Python imports
            py_m = py_import_pattern.match(line)
            if py_m:
                mod = py_m.group(1) or py_m.group(2)
                if mod:
                    imports.add(mod.split(".")[0])

            # Check JS imports
            js_m = js_import_pattern.match(line)
            if js_m:
                imports.add(js_m.group(1).split("/")[-1])

            # Collect identifier symbols
            for sym in symbol_pattern.findall(line):
                # Filter out standard keywords
                if sym not in {"def", "class", "async", "return", "import", "from", "function", "const", "export", "true", "false", "null", "None"}:
                    symbols.add(sym)

        return symbols, imports


chunker = CodeChunker()
