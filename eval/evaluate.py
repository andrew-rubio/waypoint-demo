"""Foundry evaluation runner — step 2 of the Waypoint eval pipeline.

Takes the agent responses captured by ``eval/run-agent.mjs`` (query + response +
tool_calls, derived from the approved Gherkin scenarios) and scores them in
Microsoft Foundry using built-in agent evaluators plus one custom rubric
evaluator that grades each answer against the Gherkin-derived
``expected_behavior``. Results publish to the project's Evaluations tab.

Usage:
    python eval/evaluate.py [--input <responses.jsonl>] [--name <run-name>]

Auth: Azure CLI (``az login``); a longer subprocess timeout avoids the cold
``az.cmd`` start-up racing the default 10s limit. Endpoint / model come from env
or the built-in defaults below.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone

from azure.identity import AzureCliCredential
from azure.ai.projects import AIProjectClient
from openai.types.eval_create_params import DataSourceConfigCustom
from openai.types.evals.create_eval_jsonl_run_data_source_param import (
    CreateEvalJSONLRunDataSourceParam,
    SourceFileID,
)

DEFAULT_ENDPOINT = "https://aif-dnszpz4hqfi7g.services.ai.azure.com/api/projects/waypoint"
DEFAULT_MODEL = "gpt-5.4-mini"
DEFAULT_INPUT = ".foundry/datasets/waypoint-agent-smoke-responses.jsonl"

TIMESTAMP = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("waypoint-eval")
logging.getLogger("azure").setLevel(logging.WARNING)  # silence verbose SDK HTTP logs


class CachingCredential:
    """Wrap a credential and cache tokens per scope.

    The Azure CLI credential shells out to a cold ``az.cmd`` on every token
    request (~60s each on this machine). The SDK requests the same scope many
    times over an eval run, so we cache each token until shortly before expiry
    and invoke ``az`` only once per scope.
    """

    def __init__(self, inner) -> None:
        self._inner = inner
        self._lock = threading.Lock()
        self._info: dict[tuple, object] = {}
        self._token: dict[tuple, object] = {}

    def get_token_info(self, *scopes, options=None):
        with self._lock:
            cached = self._info.get(scopes)
            if cached is not None and cached.expires_on - time.time() > 300:
                return cached
            info = self._inner.get_token_info(*scopes, options=options)
            self._info[scopes] = info
            return info

    def get_token(self, *scopes, **kwargs):
        with self._lock:
            cached = self._token.get(scopes)
            if cached is not None and cached.expires_on - time.time() > 300:
                return cached
            token = self._inner.get_token(*scopes, **kwargs)
            self._token[scopes] = token
            return token

    def close(self) -> None:
        try:
            self._inner.close()
        except Exception:  # noqa: BLE001
            pass

    def __enter__(self):
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

# Custom rubric: grade the agent answer against the Gherkin-derived expected
# behaviour — the bridge from the approved test suite to the eval scores.
GHERKIN_RUBRIC_SYSTEM = (
    "You are grading a travel-assistant answer against the acceptance criteria that were "
    "written and approved as the application's behavioural test suite. Judge ONLY whether the "
    "response satisfies the expected behaviour for the given query. Do not reward extra detail "
    "that is not required, and do not penalise correct answers for stylistic choices. If the "
    "expected behaviour asks for a specific shape (exactly one clarifying question, a grounded "
    "weather figure, a currency conversion, a specific tool result), check that shape is present. "
    "Judge shape and intent, not real-time factual values you cannot verify. "
    "Score 1-5: 5 fully satisfies every part; 4 core intent met with a minor omission; "
    "3 partially satisfies with a required element missing or weak; 2 largely fails; 1 does not satisfy."
)
GHERKIN_RUBRIC_USER = (
    "Query:\n{{item.query}}\n\n"
    "Expected behaviour (from the approved acceptance criteria):\n{{item.expected_behavior}}\n\n"
    "Agent response:\n{{item.response}}\n\n"
    "Return a single integer score from 1 to 5 for how well the response satisfies the expected behaviour."
)

# --- Domain-scoped custom evaluators (each self-scopes: out-of-domain turns score 5) ---

WEATHER_GROUNDING_SYSTEM = (
    "You grade whether a weather / best-time-to-visit answer is GROUNDED in the Open-Meteo "
    "climate-normals data the agent retrieved (shown in TOOL CONTEXT). You cannot verify live "
    "weather, so judge grounding and shape, NOT real-world accuracy. "
    "APPLICABILITY: this evaluator only applies to weather / timing turns whose tool context contains "
    "open-meteo climate data. If the query is not about weather or timing (no open-meteo data in "
    "context), it does not apply — return 5 with reason 'not a weather turn'. "
    "For weather turns score 1-5: 5 = every climate figure or seasonal claim in the answer is supported "
    "by the retrieved data and no numbers are invented; 3 = loosely grounded or vague; "
    "1 = fabricates figures or ignores the retrieved climate data."
)
GUIDE_GROUNDING_SYSTEM = (
    "You grade whether a destination recommendation is GROUNDED in the travel-guide passages the agent "
    "retrieved (shown in TOOL CONTEXT). Judge grounding, not your own travel opinions. "
    "APPLICABILITY: this evaluator only applies to destination-advice turns whose tool context contains "
    "travel-guide results. If the query is not asking for a destination recommendation (no travel-guide "
    "data in context), it does not apply — return 5 with reason 'not a destination turn'. "
    "For destination turns score 1-5: 5 = every recommended destination and supporting claim is present "
    "in the retrieved guide passages and nothing is invented; 3 = partially grounded; "
    "1 = recommends destinations absent from the guide or fabricates justifications."
)
ONE_QUESTION_SYSTEM = (
    "You grade whether a VAGUE, underspecified opener is handled by asking EXACTLY ONE focused "
    "clarifying question and showing NO premature destination list. "
    "APPLICABILITY: this evaluator only applies to vague openers with no stated preference "
    "(e.g. 'recommend somewhere', 'where should I go', 'help me plan a trip'). If the query already "
    "contains a concrete preference — a month, vibe, activity, city, or budget — it does not apply, "
    "return 5 with reason 'not a vague turn'. "
    "For vague turns score 1-5: 5 = exactly one focused clarifying question and no destination list; "
    "3 = a question plus premature suggestions, or more than one question; "
    "1 = a full destination list with no clarifying question."
)
SCOPE_ADHERENCE_SYSTEM = (
    "Waypoint is a holiday-planning assistant. It must POLITELY DECLINE anything outside travel "
    "planning (tax, legal, medical, coding, general knowledge, etc.) and redirect to trip planning — "
    "helping with an off-task request is a failure, not a success. This inverts the usual helpfulness "
    "metrics on purpose. "
    "APPLICABILITY: this evaluator only applies to OUT-OF-SCOPE requests — anything not about "
    "destinations, travel weather/timing, flights, hotels, trips, or budgets. If the query IS a "
    "legitimate travel-planning request, it does not apply — return 5 with reason 'in-scope travel request'. "
    "For out-of-scope requests score 1-5: 5 = clearly declines the off-task request AND redirects to "
    "travel planning, without attempting to fulfil it; 3 = declines but ambiguously or partly engages "
    "with the off-task request; 1 = attempts to help with the out-of-scope request."
)
GROUNDING_USER = (
    "Query:\n{{item.query}}\n\n"
    "Tool context (data the agent retrieved):\n{{item.tool_context}}\n\n"
    "Agent response:\n{{item.response}}\n\n"
    "Return a single integer score from 1 to 5 per the rubric."
)
ONE_QUESTION_USER = (
    "Query:\n{{item.query}}\n\n"
    "Agent response:\n{{item.response}}\n\n"
    "Return a single integer score from 1 to 5 per the rubric."
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Waypoint agent evaluation in Foundry.")
    parser.add_argument("--input", default=os.environ.get("WAYPOINT_EVAL_INPUT", DEFAULT_INPUT))
    parser.add_argument("--endpoint", default=os.environ.get("FOUNDRY_PROJECT_ENDPOINT", DEFAULT_ENDPOINT))
    parser.add_argument("--model", default=os.environ.get("FOUNDRY_EVAL_MODEL", DEFAULT_MODEL))
    parser.add_argument("--name", default=f"waypoint-smoke-{TIMESTAMP}")
    parser.add_argument("--threshold", type=float, default=3.0)
    parser.add_argument(
        "--gate",
        default=None,
        help="Path to a JSON map of {evaluator: min_pass_rate}. Exit non-zero if any criterion is below its threshold.",
    )
    return parser.parse_args()


def build_testing_criteria(model: str, threshold: float) -> list[dict]:
    """Built-in agent evaluators (query+response) plus a model-graded Gherkin rubric."""
    builtin = {"query": "{{item.query}}", "response": "{{item.response}}"}
    criteria: list[dict] = [
        {
            "type": "azure_ai_evaluator",
            "name": "intent_resolution",
            "evaluator_name": "builtin.intent_resolution",
            "data_mapping": builtin,
            "initialization_parameters": {"deployment_name": model},
        },
        {
            "type": "azure_ai_evaluator",
            "name": "task_adherence",
            "evaluator_name": "builtin.task_adherence",
            "data_mapping": builtin,
            "initialization_parameters": {"deployment_name": model},
        },
        {
            "type": "azure_ai_evaluator",
            "name": "relevance",
            "evaluator_name": "builtin.relevance",
            "data_mapping": builtin,
            "initialization_parameters": {"deployment_name": model},
        },
        # Custom rubric (OpenAI-native model grader) — no pre-registration needed.
        {
            "type": "score_model",
            "name": "gherkin_rubric",
            "model": model,
            "input": [
                {"role": "system", "content": GHERKIN_RUBRIC_SYSTEM},
                {"role": "user", "content": GHERKIN_RUBRIC_USER},
            ],
            "range": [1, 5],
            "pass_threshold": threshold,
        },
        # Domain-scoped custom evaluators (self-scoping; out-of-domain turns score 5).
        {
            "type": "score_model",
            "name": "weather_grounding",
            "model": model,
            "input": [
                {"role": "system", "content": WEATHER_GROUNDING_SYSTEM},
                {"role": "user", "content": GROUNDING_USER},
            ],
            "range": [1, 5],
            "pass_threshold": threshold,
        },
        {
            "type": "score_model",
            "name": "guide_grounding",
            "model": model,
            "input": [
                {"role": "system", "content": GUIDE_GROUNDING_SYSTEM},
                {"role": "user", "content": GROUNDING_USER},
            ],
            "range": [1, 5],
            "pass_threshold": threshold,
        },
        {
            "type": "score_model",
            "name": "one_clarifying_question",
            "model": model,
            "input": [
                {"role": "system", "content": ONE_QUESTION_SYSTEM},
                {"role": "user", "content": ONE_QUESTION_USER},
            ],
            "range": [1, 5],
            "pass_threshold": threshold,
        },
        {
            "type": "score_model",
            "name": "scope_adherence",
            "model": model,
            "input": [
                {"role": "system", "content": SCOPE_ADHERENCE_SYSTEM},
                {"role": "user", "content": ONE_QUESTION_USER},
            ],
            "range": [1, 5],
            "pass_threshold": threshold,
        },
    ]
    return criteria


def main() -> None:
    args = parse_args()
    logger.info("Endpoint: %s", args.endpoint)
    logger.info("Model:    %s", args.model)
    logger.info("Dataset:  %s", args.input)

    credential = CachingCredential(AzureCliCredential(process_timeout=120))
    with (
        AIProjectClient(endpoint=args.endpoint, credential=credential) as project_client,
        project_client.get_openai_client() as openai_client,
    ):
        logger.info("Uploading dataset...")
        dataset = project_client.datasets.upload_file(
            name=f"waypoint-smoke-eval-{TIMESTAMP}",
            version="1",
            file_path=args.input,
        )
        logger.info("Dataset uploaded: %s (ID: %s)", dataset.name, dataset.id)

        data_source_config = DataSourceConfigCustom(
            {
                "type": "custom",
                "item_schema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "response": {"type": "string"},
                        "expected_behavior": {"type": "string"},
                        "tool_context": {"type": "string"},
                        "context": {"type": "string"},
                        "smoke_reason": {"type": "string"},
                        "source": {"type": "string"},
                    },
                    "required": [],
                },
                "include_sample_schema": True,
            }
        )

        testing_criteria = build_testing_criteria(args.model, args.threshold)

        logger.info("Creating evaluation...")
        evaluation = openai_client.evals.create(
            name=args.name,
            data_source_config=data_source_config,
            testing_criteria=testing_criteria,
        )
        logger.info("Evaluation created: %s", evaluation.id)

        logger.info("Starting evaluation run...")
        run = openai_client.evals.runs.create(
            eval_id=evaluation.id,
            name=f"{args.name}-run",
            data_source=CreateEvalJSONLRunDataSourceParam(
                type="jsonl",
                source=SourceFileID(type="file_id", id=dataset.id),
            ),
        )
        logger.info("Run created: %s", run.id)

        while run.status not in ("completed", "failed"):
            time.sleep(5)
            run = openai_client.evals.runs.retrieve(run_id=run.id, eval_id=evaluation.id)
            logger.info("Status: %s", run.status)

        logger.info("Report URL: %s", run.report_url)

        if run.status == "completed":
            output_items = [
                item.model_dump()
                for item in openai_client.evals.runs.output_items.list(run_id=run.id, eval_id=evaluation.id)
            ]
            out_file = f"eval/.out/eval_results_{TIMESTAMP}.json"
            os.makedirs(os.path.dirname(out_file), exist_ok=True)
            with open(out_file, "w", encoding="utf-8") as handle:
                json.dump(output_items, handle, indent=2, default=str)
            logger.info("Results saved to %s", out_file)
            print_summary(output_items, run.report_url)
            check_gate(output_items, args.gate)
        else:
            logger.error("Evaluation failed with status: %s", run.status)
            raise SystemExit(1)


def check_gate(output_items: list[dict], gate_path: str | None) -> None:
    """Enforce per-evaluator minimum pass rates; exit non-zero on any breach.

    Only evaluators listed in the gate file are enforced; others are reported by
    ``print_summary`` but do not block. Used by CI to fail a regressing build.
    """
    if not gate_path:
        return
    with open(gate_path, encoding="utf-8") as handle:
        thresholds: dict[str, float] = json.load(handle)

    counts: dict[str, dict[str, int]] = {}
    for item in output_items:
        for res in item.get("results", []) or []:
            bucket = counts.setdefault(res.get("name", "?"), {"pass": 0, "total": 0})
            bucket["total"] += 1
            if res.get("passed") is True:
                bucket["pass"] += 1

    print("\nQuality gate")
    print("  " + "-" * 54)
    failures: list[str] = []
    for crit in sorted(thresholds):
        min_rate = float(thresholds[crit])
        bucket = counts.get(crit)
        if not bucket or bucket["total"] == 0:
            print(f"  {crit:<22} NO DATA        required >= {min_rate:.0%}  FAIL")
            failures.append(crit)
            continue
        rate = bucket["pass"] / bucket["total"]
        ok = rate >= min_rate
        status = "PASS" if ok else "FAIL"
        print(f"  {crit:<22} {rate:>4.0%} ({bucket['pass']}/{bucket['total']:<2})  required >= {min_rate:.0%}  {status}")
        if not ok:
            failures.append(crit)
    print("  " + "-" * 54)

    if failures:
        logger.error("Quality gate FAILED: %s", ", ".join(failures))
        raise SystemExit(1)
    print("  Quality gate PASSED\n")


def print_summary(output_items: list[dict], report_url: str | None) -> None:
    """Aggregate pass rate and average score per evaluator and print a table."""
    agg: dict[str, dict[str, float]] = {}
    for item in output_items:
        for res in item.get("results", []) or []:
            name = res.get("name", "?")
            bucket = agg.setdefault(name, {"pass": 0, "total": 0, "score_sum": 0.0, "scored": 0})
            bucket["total"] += 1
            if res.get("passed") is True:
                bucket["pass"] += 1
            score = res.get("score")
            if isinstance(score, (int, float)):
                bucket["score_sum"] += float(score)
                bucket["scored"] += 1

    print("\n" + "=" * 56)
    print(f"  Evaluation summary — {len(output_items)} rows")
    print("=" * 56)
    print(f"  {'evaluator':<22}{'pass':>10}{'avg score':>12}")
    print("  " + "-" * 44)
    for name in sorted(agg):
        b = agg[name]
        avg = f"{b['score_sum'] / b['scored']:.2f}" if b["scored"] else "n/a"
        print(f"  {name:<22}{b['pass']}/{b['total']:<8}{avg:>12}")
    print("=" * 56)
    if report_url:
        print(f"  Report: {report_url}")
    print()


if __name__ == "__main__":
    main()
