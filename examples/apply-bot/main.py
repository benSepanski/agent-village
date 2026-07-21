#!/usr/bin/env python3
"""apply-bot — a job-application assistant, and the AC-5.4 dependent-project
fixture (deploy-your-own-instance).

Reads a curated job list from the durable workspace, skips jobs already
applied to (tracked in `state.json`), and — best-effort — asks the metered
Anthropic gateway to draft one outreach line per new job. State (including
what's already been applied to) persists under
`<AV_WORKSPACE_DIR|/workspace>/apply-bot/`, which the sandbox entrypoint syncs
to/from S3 around every run.

Zero third-party runtime dependencies: everything here is the Python standard
library, so the `python` sandbox image (examples/python-sandbox-image) needs
no `pip install` step to run this fixture as-is. See requirements.txt for how
to pin real job-board scraping libraries when you extend it.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

APP_NAME = "apply-bot"
STATE_FILENAME = "state.json"
JOBS_FILENAME = "jobs.json"
DEFAULT_MODEL = "claude-haiku-4-5"
DEFAULT_MAX_PER_RUN = 3


def workspace_dir() -> Path:
    """Durable workspace root; AV_WORKSPACE_DIR overrides the platform default
    (set by the sandbox entrypoint, and by tests running outside the sandbox)."""
    return Path(os.environ.get("AV_WORKSPACE_DIR", "/workspace"))


def state_path() -> Path:
    return workspace_dir() / APP_NAME / STATE_FILENAME


def jobs_path() -> Path:
    return workspace_dir() / APP_NAME / JOBS_FILENAME


def load_state() -> dict:
    try:
        return json.loads(state_path().read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {"appliedJobIds": [], "runCount": 0, "lastRunAt": None}


def save_state(state: dict) -> None:
    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def load_target_jobs() -> list[dict]:
    """Job listings to consider this run. Curated by the operator (or a future
    job-board scraper) into `jobs.json`; missing/empty is a no-op run, which
    keeps this fixture runnable with no setup."""
    try:
        return json.loads(jobs_path().read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def max_per_run() -> int:
    try:
        return int(os.environ.get("APPLY_BOT_MAX_PER_RUN", str(DEFAULT_MAX_PER_RUN)))
    except ValueError:
        return DEFAULT_MAX_PER_RUN


def draft_note(job: dict) -> str | None:
    """Best-effort: ask the metered Anthropic gateway for a one-line outreach
    note. Every call is metered against the agent's spendLimitUsd (ADR 0004);
    the real Anthropic key never enters the sandbox — only a per-run gateway
    token does. Returns None (and logs to stderr) on any failure so a
    gateway/network hiccup never fails the whole run."""
    base_url = os.environ.get("ANTHROPIC_BASE_URL")
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not base_url or not api_key:
        print("apply-bot: no gateway credentials, skipping draft", file=sys.stderr)
        return None
    model = os.environ.get("APPLY_BOT_MODEL", DEFAULT_MODEL)
    title = job.get("title", "this role")
    company = job.get("company", "this company")
    payload = json.dumps(
        {
            "model": model,
            "max_tokens": 128,
            "messages": [
                {
                    "role": "user",
                    "content": f"Write one enthusiastic sentence applying for {title} at {company}.",
                }
            ],
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        base_url.rstrip("/") + "/v1/messages",
        data=payload,
        headers={
            "content-type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            body = json.loads(res.read().decode("utf-8"))
        text = "".join(
            block.get("text", "") for block in body.get("content", []) if block.get("type") == "text"
        )
        return text or None
    except (urllib.error.URLError, ValueError, KeyError) as exc:
        print(f"apply-bot: draft failed for {job.get('id')}: {exc}", file=sys.stderr)
        return None


def main() -> int:
    state = load_state()
    applied = set(state.get("appliedJobIds", []))
    candidates = [job for job in load_target_jobs() if job.get("id") not in applied]
    newly_applied = []
    for job in candidates[: max_per_run()]:
        note = draft_note(job)
        newly_applied.append({"id": job.get("id"), "title": job.get("title"), "note": note})
        applied.add(job.get("id"))

    state["appliedJobIds"] = sorted(str(job_id) for job_id in applied if job_id is not None)
    state["runCount"] = state.get("runCount", 0) + 1
    state["lastRunAt"] = datetime.now(timezone.utc).isoformat()
    state["lastApplications"] = newly_applied
    save_state(state)
    print(f"apply-bot: run #{state['runCount']} — {len(newly_applied)} new application(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
