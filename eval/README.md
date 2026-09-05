# Waypoint agent evaluations

Turns the **approved Gherkin test suite** into a **golden dataset** and runs it as
a Microsoft Foundry evaluation of the deployed `waypoint-agent`. Scores land in
the project's **Evaluations** tab, so the same behaviour we tested at build time
becomes the quality bar we monitor in production.

```
specs/features/*.feature ──▶ generate-dataset.mjs ──▶ seed dataset (62 rows)
                                        │
                                        └▶ smoke-slice.mjs ──▶ smoke dataset (12 rows)
                                                      │
                          run-agent.mjs (replays each query on the live agent)
                                                      │
                                                      ▼
                                     responses dataset (query + response + tools)
                                                      │
                              evaluate.py (Foundry evals: built-in + Gherkin rubric)
                                                      │
                                                      ▼
                                    Foundry Evaluations tab (scores + report URL)
```

## Pipeline

| Step | Command | Output |
|------|---------|--------|
| 1. Build golden dataset from the tests | `npm run eval:dataset` | `.foundry/datasets/waypoint-agent-eval-seed-v1.jsonl` |
| 2. Curate the smoke slice | `node eval/smoke-slice.mjs` | `.foundry/datasets/waypoint-agent-smoke-v1.jsonl` |
| 3. Replay queries on the live agent | `npm run eval:run-agent` | `.foundry/datasets/waypoint-agent-smoke-responses.jsonl` |
| 4. Score in Foundry | `eval/.venv/Scripts/python eval/evaluate.py` | Evaluations tab + `eval/.out/eval_results_*.json` |

Steps 1–2 are pure Node (no cloud). Step 3 calls the deployed agent's Responses
endpoint. Step 4 uploads the responses and runs the evaluation in Foundry.

## Evaluators

- **Built-in** (`builtin.intent_resolution`, `builtin.task_adherence`,
  `builtin.relevance`) — standard agent-quality judges, graded by `gpt-5.4-mini`.
- **`gherkin_rubric`** (custom `score_model`) — grades each answer against the
  `expected_behavior` extracted from the approved acceptance criteria. This is the
  bridge from the test suite to the eval: a 1–5 score for how well the agent meets
  the behaviour we already signed off in Gherkin.

## One-time setup

```powershell
py -m venv eval/.venv
eval/.venv/Scripts/python -m pip install -r eval/requirements.txt
az login   # the runner uses your Azure CLI credential for audience https://ai.azure.com
```

The evaluation executor needs **Cognitive Services OpenAI User**, **Azure AI
Developer**, and **Azure AI Safety Evaluator** on the Foundry account (granted to
the account's managed identity and the running user).

## Notes

- Each smoke query runs as an **independent single turn**, so scenarios that are
  inherently follow-ups (e.g. "show that in euros", "book the first flight") have
  no prior context and score lower on the rubric — that is expected, not a
  regression. Multi-turn threading is a future enhancement.
- The rubric prompt judges **shape and intent** (e.g. "exactly one clarifying
  question", "a grounded weather figure", "a currency conversion"), not real-time
  factual values the judge model cannot verify.
- Endpoint, model, and dataset paths are overridable via `--endpoint`, `--model`,
  `--input`, `--name` (see `python eval/evaluate.py --help`) or env vars
  `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_EVAL_MODEL`, `WAYPOINT_EVAL_INPUT`.

## CI quality gate

`.github/workflows/agent-eval.yml` runs the whole pipeline on every PR that
touches `src/`, `specs/features/`, or `eval/`, and **fails the build if quality
regresses** below the thresholds in [`gate.json`](gate.json):

```json
{ "relevance": 0.9, "intent_resolution": 0.75, "task_adherence": 0.8 }
```

`evaluate.py --gate eval/gate.json` computes each evaluator's pass rate and exits
non-zero if any gated criterion is below its floor. Only listed evaluators block;
others (e.g. `gherkin_rubric`) are reported but informational — the rubric stays
ungated until multi-turn threading lands, since single-turn follow-ups depress it.

Make the `eval-gate` job a **required status check** (branch protection on `main`)
so a regressing change cannot merge, and therefore cannot reach deploy.

### One-time CI setup

The workflow logs in with GitHub OIDC (no stored secrets). Create an Entra app
with a federated credential for this repo and grant it the eval roles:

```powershell
$app = az ad app create --display-name "waypoint-agent-eval-ci" --query appId -o tsv
az ad sp create --id $app
# Federated credential for PRs + manual dispatch on this repo
az ad app federated-credential create --id $app --parameters '{
  "name":"waypoint-ci","issuer":"https://token.actions.githubusercontent.com",
  "subject":"repo:andrew-rubio/waypoint-demo:pull_request","audiences":["api://AzureADTokenExchange"]}'
$sp = az ad sp show --id $app --query id -o tsv
$acct = "/subscriptions/c7233dbc-6a6d-40da-83a7-738e54ffedef/resourceGroups/rg-waypoint/providers/Microsoft.CognitiveServices/accounts/aif-dnszpz4hqfi7g"
foreach ($r in 'Cognitive Services OpenAI User','Azure AI Developer','Azure AI Safety Evaluator') {
  az role assignment create --assignee $sp --role $r --scope $acct
}
```

Then add repo secrets `AZURE_CLIENT_ID` (the app id), `AZURE_TENANT_ID`, and
`AZURE_SUBSCRIPTION_ID`. (For runs triggered by `workflow_dispatch` on a branch,
add a second federated credential with subject
`repo:andrew-rubio/waypoint-demo:ref:refs/heads/main`.)

