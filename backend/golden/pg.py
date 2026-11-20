"""Throwaway local PostgreSQL 16 for the golden harness (initdb in a temp dir)."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

PG_BIN = Path("/usr/lib/postgresql/16/bin")
BACKEND = Path(__file__).resolve().parents[1]


def _run_as_postgres(args: list[str], **kw) -> subprocess.CompletedProcess:
    if os.geteuid() == 0:
        args = ["runuser", "-u", "postgres", "--", *args]
    return subprocess.run(args, check=True, capture_output=True, text=True, **kw)


class LocalPostgres:
    def __init__(self, port: int = 55432):
        self.port = port
        self.dir = Path(tempfile.mkdtemp(prefix="golden-pg-"))
        self.data = self.dir / "data"

    @property
    def url(self) -> str:
        return f"postgresql://postgres@127.0.0.1:{self.port}/golden"

    def start(self, snapshot: Path | None = None) -> "LocalPostgres":
        """A fresh, migrated database, or (``snapshot``) a copy of a stopped
        cluster saved with :meth:`snapshot`."""
        if os.geteuid() == 0:
            shutil.chown(self.dir, "postgres", "postgres")
        if snapshot is None:
            _run_as_postgres([str(PG_BIN / "initdb"), "-D", str(self.data), "-A", "trust",
                              "-U", "postgres", "--no-sync", "-E", "UTF8", "--locale=C.UTF-8"])
        else:
            _run_as_postgres(["cp", "-a", str(snapshot), str(self.data)])
        self._pg_start()
        if snapshot is None:
            self.psql("postgres", "CREATE DATABASE golden")
            self._migrate()
        return self

    def _pg_start(self) -> None:
        _run_as_postgres([
            str(PG_BIN / "pg_ctl"), "-D", str(self.data), "-l", str(self.dir / "log"),
            "-o", f"-p {self.port} -k {self.dir} -c fsync=off -c synchronous_commit=off "
                  "-c full_page_writes=off -c autovacuum=off -c max_parallel_workers_per_gather=0 -c synchronize_seqscans=off -c listen_addresses=127.0.0.1 -c TimeZone=UTC",
            "-w", "start",
        ])

    def snapshot(self, dest: Path) -> None:
        """Stop cleanly, copy the cluster to ``dest``, start again."""
        _run_as_postgres([str(PG_BIN / "pg_ctl"), "-D", str(self.data), "-m", "fast", "-w", "stop"])
        if dest.exists():
            shutil.rmtree(dest)
        _run_as_postgres(["cp", "-a", str(self.data), str(dest)])
        self._pg_start()

    def psql(self, db: str, sql: str) -> str:
        out = subprocess.run(
            ["psql", "-v", "ON_ERROR_STOP=1", "-q", "-h", "127.0.0.1", "-p", str(self.port),
             "-U", "postgres", "-d", db, "-c", sql],
            check=True, capture_output=True, text=True,
        )
        return out.stdout

    def psql_file(self, path: Path) -> None:
        subprocess.run(
            ["psql", "-v", "ON_ERROR_STOP=1", "-q", "-h", "127.0.0.1", "-p", str(self.port),
             "-U", "postgres", "-d", "golden", "-f", str(path)],
            check=True, capture_output=True, text=True,
        )

    def _migrate(self) -> None:
        mig = BACKEND / "migrations"
        files = [Path(__file__).with_name("schema_base.sql")]
        files += sorted(mig.glob("create_*.sql"))
        files += sorted(mig.glob("add_*.sql"))
        files += sorted(mig.glob("drop_*.sql"))
        for f in files:
            self.psql_file(f)

    def stop(self) -> None:
        try:
            _run_as_postgres([str(PG_BIN / "pg_ctl"), "-D", str(self.data), "-m", "immediate", "stop"])
        except subprocess.CalledProcessError:
            pass
        shutil.rmtree(self.dir, ignore_errors=True)
