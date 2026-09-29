"""Publish Novel Mania after a specific monitored repair run finishes."""
import argparse
import asyncio
from datetime import datetime, timezone
import fcntl
from pathlib import Path

from oghma.db import SessionLocal
from oghma.models import CrawlRun
from oghma.publish.runner import run as publish


async def main(run_id: int):
    while True:
        async with SessionLocal() as session:
            repair = await session.get(CrawlRun, run_id)
            if repair is None or repair.source_id != "novel-mania":
                raise ValueError("Expected a Novel Mania repair run")
            stats = dict(repair.stats)
            if repair.status != "running":
                if stats.get("stage") != "done":
                    raise RuntimeError("Repair did not finish; publication requires review")
                break
            heartbeat = stats.get("last_heartbeat_at")
            if heartbeat and (datetime.now(timezone.utc) - datetime.fromisoformat(heartbeat)).total_seconds() > 1800:
                raise RuntimeError("Repair heartbeat expired; publication requires review")
        await asyncio.sleep(30)

    # Match the host cron lock to avoid concurrent index.json/state publications.
    with Path("/locks/crawl-daily-completed.lock").open("a") as lock:
        await asyncio.to_thread(fcntl.flock, lock, fcntl.LOCK_EX)
        async with SessionLocal() as session:
            task = CrawlRun(source_id="novel-mania", status="running", stats={
                "stage": "publishing", "last_event": "Publicando recuperacao no B2",
                "last_heartbeat_at": datetime.now(timezone.utc).isoformat(), "repair_run_id": run_id,
            })
            session.add(task)
            await session.commit()
            try:
                result = await publish("novel-mania")
                if not result.get("uploaded"):
                    raise RuntimeError("Publication did not upload")
                task.status = "done"
                task.stats = {"stage": "done", "last_event": "Recuperacao publicada no B2", **result}
                print(result, flush=True)
            except BaseException as exc:
                task.status = "error"
                task.error = str(exc)
                raise
            finally:
                task.finished_at = datetime.now(timezone.utc)
                await session.commit()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True, type=int)
    args = parser.parse_args()
    print(f"Waiting for repair run {args.run_id}", flush=True)
    asyncio.run(main(args.run_id))
