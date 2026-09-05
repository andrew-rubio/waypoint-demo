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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Waypoint agent evaluation in Foundry.")
    parser.add_argument("--input", default=os.environ.get("WAYPOINT_EVAL_INPUT", DEFAULT_INPUT))
    parser.add_argument("--endpoint", default=os.environ.get("FOUNDRY_PROJECT_ENDPOINT", DEFAULT_ENDPOINT))
    parser.add_argument("--model", default=os.environ.get("FOUNDRY_EVAL_MODEL", DEFAULT_MODEL))
    parser.add_argument("--name", default=f"waypoint-smoke-{TIMESTAMP}")
    parser.add_argument("--threshold", type=float, default=3.0)
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
        else:
            logger.error("Evaluation failed with status: %s", run.status)
            raise SystemExit(1)


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
