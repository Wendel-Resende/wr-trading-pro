#!/usr/bin/env python3
"""Verify that the WR Trading Pro CVM database matches the Guardião 138-company certification.

Read-only gate. It does not modify the SQLite database.
"""
from __future__ import annotations

import argparse
import csv
import json
import sqlite3
from pathlib import Path
from typing import Any

DEFAULT_REPO = Path(__file__).resolve().parents[1]
DEFAULT_CERT = Path(
    "/root/.hermes/workspace/cvm_fundamentos/data/exports/"
    "b3_cvm_identity_audit_all_20260726_v6/local_review/final_certification/"
    "final_cvm_identity_certification_138.csv"
)
MAJOR_TABLES = [
    "dre_trimestral",
    "bpa_trimestral",
    "bpp_trimestral",
    "dfc_trimestral",
    "dva_trimestral",
    "dra_trimestral",
    "capital_social",
]
OPTIONAL_TABLES = ["dividendos_jcp_dmpl"]
FORBIDDEN_LOCALIZA_FLEET_CD = "024813"
EXPECTED_RENT3_CD = "019739"
EXPECTED_RENT3_CNPJ = "16.670.085/0001-55"


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def table_count(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> int:
    return int(conn.execute(sql, params).fetchone()[0])


def verify(repo: Path, certification_csv: Path) -> dict[str, Any]:
    db_path = repo / "data/cvm/cvm_fundamentos.db"
    if not db_path.exists():
        raise FileNotFoundError(f"WR CVM DB not found: {db_path}")
    if not certification_csv.exists():
        raise FileNotFoundError(f"Certification CSV not found: {certification_csv}")

    cert_rows = load_csv(certification_csv)
    cert_by_ticker = {row["ticker"]: row for row in cert_rows}

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    empresas = [dict(r) for r in conn.execute("SELECT ticker, cd_cvm, nome, cnpj FROM empresas ORDER BY ticker")]

    issues: list[str] = []
    if len(empresas) != 138:
        issues.append(f"empresas_count={len(empresas)}")
    if len(cert_rows) != 138:
        issues.append(f"certification_rows={len(cert_rows)}")
    if len({row["ticker"] for row in empresas}) != len(empresas):
        issues.append("duplicate_ticker_in_wr_db")
    if len({row["cd_cvm"] for row in empresas}) != len(empresas):
        issues.append("duplicate_cd_cvm_in_wr_db")

    for empresa in empresas:
        ticker = empresa["ticker"]
        cert = cert_by_ticker.get(ticker)
        if not cert:
            issues.append(f"{ticker}:missing_in_certification")
            continue
        if empresa["cd_cvm"] != cert["cd_cvm_db"]:
            issues.append(f"{ticker}:cd_cvm_mismatch:{empresa['cd_cvm']}!={cert['cd_cvm_db']}")
        cnpj_db = (empresa.get("cnpj") or "").strip()
        cnpj_cvm = (cert.get("cnpj_cvm_cad") or "").strip()
        if cnpj_db and cnpj_cvm and cnpj_db != cnpj_cvm:
            issues.append(f"{ticker}:cnpj_mismatch:{cnpj_db}!={cnpj_cvm}")
        if cert.get("blocking_issues"):
            issues.append(f"{ticker}:certification_blocking:{cert['blocking_issues']}")

    coverage = {}
    orphans = {}
    forbidden_localiza_rows = {}
    for table in MAJOR_TABLES + OPTIONAL_TABLES:
        coverage[table] = table_count(conn, f"SELECT COUNT(DISTINCT cd_cvm) FROM {table}")
        orphans[table] = table_count(
            conn,
            f"SELECT COUNT(*) FROM {table} WHERE cd_cvm NOT IN (SELECT cd_cvm FROM empresas)",
        )
        forbidden_localiza_rows[table] = table_count(
            conn,
            f"SELECT COUNT(*) FROM {table} WHERE cd_cvm = ?",
            (FORBIDDEN_LOCALIZA_FLEET_CD,),
        )

    forbidden_localiza_rows["empresas"] = table_count(
        conn,
        "SELECT COUNT(*) FROM empresas WHERE cd_cvm = ?",
        (FORBIDDEN_LOCALIZA_FLEET_CD,),
    )

    for table in MAJOR_TABLES:
        if coverage[table] != 138:
            issues.append(f"{table}:distinct_cd={coverage[table]}")
    for table, count in orphans.items():
        if count:
            issues.append(f"{table}:orphan_rows={count}")
    for table, count in forbidden_localiza_rows.items():
        if count:
            issues.append(f"{table}:forbidden_localiza_fleet_024813_rows={count}")

    rent = conn.execute(
        "SELECT cd_cvm, cnpj, nome FROM empresas WHERE ticker = 'RENT3'"
    ).fetchone()
    rent3_ok = bool(rent) and rent["cd_cvm"] == EXPECTED_RENT3_CD and rent["cnpj"] == EXPECTED_RENT3_CNPJ
    if not rent3_ok:
        issues.append("RENT3_guard_failed")

    result = {
        "verdict": "PASS" if not issues else "FAIL",
        "wr_db": str(db_path),
        "certification_csv": str(certification_csv),
        "empresas_count": len(empresas),
        "certification_rows": len(cert_rows),
        "major_table_coverage": coverage,
        "orphan_rows": orphans,
        "forbidden_localiza_fleet_024813_rows": forbidden_localiza_rows,
        "rent3_guard_ok": rent3_ok,
        "issues": issues,
    }
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=DEFAULT_REPO)
    parser.add_argument("--certification-csv", type=Path, default=DEFAULT_CERT)
    args = parser.parse_args()
    result = verify(args.repo, args.certification_csv)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["verdict"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
