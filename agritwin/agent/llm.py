"""Model backends behind one switch.

Priority in `auto` mode: a local open-weights model via Ollama (household data never leaves the office),
then an open-weights model hosted on OpenRouter (Gemma 4 / Nemotron 3 free tier), then Anthropic if a
key is set (frontier comparison only), then no model at all: the deterministic template drafter.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass

import httpx

from ..config import settings

OPEN_WEIGHTS = re.compile(r"qwen|llama|gemma|mistral|mixtral|nemotron|glm|kimi|aya|deepseek|phi|olmo|command-r", re.I)


@dataclass(frozen=True)
class ModelInfo:
    provider: str          # ollama | openrouter | anthropic | template
    model: str | None
    openWeights: bool
    kind: str              # llm | template
    note: str = ""

    def dict(self) -> dict:
        return asdict(self)


def _ollama_ok(host: str, model: str) -> tuple[str | None, str]:
    """Return (model_to_use, note). Falls back to any pulled open-weights chat model if the configured one is missing."""
    try:
        r = httpx.get(f"{host.rstrip('/')}/api/tags", timeout=1.5)
        r.raise_for_status()
        names = [m.get("name", "") for m in r.json().get("models", [])]
        exact = [n for n in names if n == model or n.split(":")[0] == model.split(":")[0]]
        if exact:
            return exact[0], ""
        usable = [n for n in names if OPEN_WEIGHTS.search(n) and "embed" not in n]
        if usable:
            return usable[0], f"'{model}' is not pulled; using '{usable[0]}'"
        return None, f"Ollama is up but no chat model is pulled (ollama pull {model})"
    except Exception as e:  # noqa: BLE001
        return None, f"Ollama not reachable at {host} ({type(e).__name__})"


def resolve(provider: str | None = None) -> tuple[object | None, ModelInfo]:
    """Return (chat_model_or_None, info). Never raises: a missing backend degrades to the template drafter."""
    s = settings()
    provider = (provider or s.model_provider or "auto").lower()
    notes: list[str] = []

    if provider in ("auto", "ollama"):
        name, why = _ollama_ok(s.ollama_host, s.ollama_model)
        if name:
            from langchain_ollama import ChatOllama
            return ChatOllama(model=name, base_url=s.ollama_host, temperature=0.2, num_ctx=6144, num_predict=450,
                              reasoning=False, keep_alive='30m'), \
                ModelInfo("ollama", name, True, "llm", "local open-weights via Ollama" + (f" ({why})" if why else ""))
        notes.append(why)
        if provider == "ollama":
            return None, ModelInfo("template", None, True, "template", "; ".join(notes))

    if provider in ("auto", "openrouter"):
        if s.openrouter_key:
            from langchain_openai import ChatOpenAI
            kw = dict(base_url="https://openrouter.ai/api/v1", api_key=s.openrouter_key, temperature=0.2, max_tokens=900,
                      timeout=90, max_retries=1,
                      default_headers={"HTTP-Referer": "https://github.com/agritwin", "X-Title": "AgriTwin Advisory Desk"})
            primary = ChatOpenAI(model=s.openrouter_model, **kw)
            model = primary
            if s.openrouter_fallback_model and s.openrouter_fallback_model != s.openrouter_model:
                model = primary.with_fallbacks([ChatOpenAI(model=s.openrouter_fallback_model, **kw)])
            return model, ModelInfo("openrouter", s.openrouter_model, bool(OPEN_WEIGHTS.search(s.openrouter_model)), "llm",
                                    "hosted open-weights via OpenRouter" + (f" (fallback {s.openrouter_fallback_model})" if s.openrouter_fallback_model else ""))
        notes.append("no OPENROUTER_API_KEY")
        if provider == "openrouter":
            return None, ModelInfo("template", None, True, "template", "; ".join(notes))

    if provider in ("auto", "anthropic"):
        if s.anthropic_key:
            from langchain_anthropic import ChatAnthropic
            return ChatAnthropic(model=s.anthropic_model, api_key=s.anthropic_key, temperature=0.2, max_tokens=900), \
                ModelInfo("anthropic", s.anthropic_model, False, "llm", "frontier model (comparison only; not open-weights)")
        notes.append("no ANTHROPIC_API_KEY")

    return None, ModelInfo("template", None, True, "template", "deterministic template drafter: " + "; ".join(notes))
