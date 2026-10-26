"""Background execution of pipeline runs.

Production: each run is a Cloud Task that POSTs back to /tasks/run on this
service (OIDC-authenticated). Cloud Tasks gives retries and a 30-minute
deadline, and Cloud Run keeps the CPU allocated for the request.
Development: runs in a background thread.
"""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Literal

from pydantic import BaseModel

from .config import settings
from .llm import get_llm
from .pipeline import Pipeline
from .schemas import JobStatus
from .store import get_store

log = logging.getLogger(__name__)
STALE_AFTER = timedelta(minutes=35)


class TaskBody(BaseModel):
    job_id: str
    action: Literal["generate", "revise", "concept"] = "generate"
    feedback: str = ""
    concept_index: int = 0
    by: str = ""


def _claimable(job) -> bool:
    if job.status == JobStatus.queued:
        return True
    if job.status == JobStatus.running:  # a previous attempt died mid-run
        updated = datetime.fromisoformat(job.updated_at)
        return datetime.now(timezone.utc) - updated > STALE_AFTER
    return False


def execute(task: TaskBody) -> None:
    store = get_store()
    job = store.get_job(task.job_id)
    if not job or not _claimable(job):
        log.info("skip task %s (%s)", task.job_id, job.status if job else "missing")
        return
    pipe = Pipeline(get_llm(), store)
    if task.action == "generate":
        pipe.run(job)
    elif task.action == "revise":
        pipe.revise_with_feedback(job, task.feedback, by=task.by)
    else:
        pipe.rerun_with_concept(job, task.concept_index, by=task.by)


def dispatch(task: TaskBody) -> None:
    if settings.tasks_queue:
        from google.cloud import tasks_v2
        base = (settings.worker_url or settings.public_base_url).rstrip("/")
        tasks_v2.CloudTasksClient().create_task(parent=settings.tasks_queue, task={
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": base + "/tasks/run",
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps(task.model_dump()).encode(),
                "oidc_token": {"service_account_email": settings.tasks_service_account, "audience": base},
            },
            "dispatch_deadline": {"seconds": 1800},
        })
    else:
        threading.Thread(target=execute, args=(task,), daemon=True).start()
