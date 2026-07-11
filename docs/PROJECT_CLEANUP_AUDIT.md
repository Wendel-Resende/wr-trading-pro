# WR Trade Pro - Project cleanup audit

Date: 2026-05-20

## Goal

Prepare the repository for GitHub by keeping only platform-relevant files, removing local artifacts, organizing reference material, and preventing secrets/runtime data from being committed.

## Current Architecture Target

- `src/`: Next.js/React application code.
- `electron/`: Electron main/preload source and compiled Electron output required by the app.
- `python/`: Python services used by the desktop app.
- `agents/`: agent pipeline used by `/api/agents`.
- `data/`: repo-local runtime data boundary; only documentation/placeholders should be versioned, databases stay ignored.
- `docs/`: active project documentation, handoff, architecture notes, and archived reference docs.
- `public/`, `prisma/`, root config files: application configuration and assets.

## Keep And Version

| Path | Reason |
| --- | --- |
| `AGENTS.md` | Required project protocol for future Codex sessions. |
| `docs/CODEX_HANDOFF.md` | Operational handoff required by `AGENTS.md`. |
| `data/README.md` | Documents repo-local runtime data boundary. |
| `electron/better-sqlite3.d.ts` | Type shim needed because Electron uses `better-sqlite3`. |
| `python/options/dashboard_opcoes_(versao base apoio).py` | Reference implementation for Options parity. |
| `python/options/DIVERGENCIAS_SCANNER_vs_DASHBOARD.md` | Useful historical diagnosis, but should move under `docs/archive/options/`. |

## Keep Locally But Do Not Version

| Path | Reason |
| --- | --- |
| `.env` | Contains local credentials and API keys; already ignored. |
| `data/options/options_data.db` | Canonical local runtime DB; already ignored. |
| `release/` | Official local Electron build output; generated artifact. |
| `.next/`, `node_modules/`, `tsconfig.tsbuildinfo` | Generated dependency/build/cache artifacts. |

## Move Out Of Runtime Folders

| Path | Proposed Destination | Reason |
| --- | --- | --- |
| `WR Trading Pro - Avaliação de Modelos LLM.md` | `docs/archive/llm-evaluations/` | Useful historical note, not app source. |
| `python/options/test_mt5_options.py` | `docs/archive/options/manual-checks/` | Exploratory MT5 check, not production code. |
| `python/options/test_mt5_options2.py` | `docs/archive/options/manual-checks/` | Exploratory MT5 check, not production code. |
| `python/options/test_mt5_vale.py` | `docs/archive/options/manual-checks/` | Exploratory MT5 check, not production code. |
| Root `MT5_*.md.NOT_USED` files | `docs/archive/mt5/` | Tracked root-level legacy docs should not stay loose in project root. |
| `PROFIT_DLL_INTEGRATION_STATUS.md` | `docs/profitdll/` | Project documentation should live under `docs/`. |

## Delete After Approval

| Path | Reason |
| --- | --- |
| `codex-electron-check/` | 1 GB Electron validation artifact. |
| `codex-electron-check-fixed/` | 1 GB Electron validation artifact. |
| `codex-electron-check-final/` | 1 GB Electron validation artifact. |
| `codex_ws_check.py` | Temporary WebSocket validation script. |
| `.obsidian/` | Local Obsidian UI state, not project source. |
| `2026-05-15.md` | Empty loose note. |
| `Sem título.canvas` | Empty Obsidian canvas. |
| `python/options/options_data.db` | Legacy duplicate DB; canonical DB is `data/options/options_data.db`. |
| `__pycache__/` and nested `__pycache__/` folders | Python cache artifacts. |
| `graphify-out/` | Generated Graphify analysis cache/output. |
| `agent_workspace/` | Generated agent runtime workspace. |

## Security Findings Before GitHub

- `.env` has non-empty values for API keys, ProfitDLL, B3, and MT5 configuration. It is ignored and must not be committed.
- Tracked legacy docs contain real MT5 account/server/password examples. They must be sanitized before any public or private GitHub push.
- Because those docs are already in local commits, the repository history should be cleaned before first push if the remote must not contain those secrets.

## Architectural Risks

- `agents/` is used by `/api/agents`, but `package.json` Electron build files do not include `agents/**/*`. If the desktop app needs agent features in packaged mode, packaging should be adjusted.
- Files under `python/options/` are included in Electron packaging through `python/**/*`; exploratory scripts should be moved away from that folder before packaging.
- `ProfitDLL/` is large and tracked. It is a future-integration reference, not current runtime. Decide whether GitHub should store DLL/manual binaries or only a note pointing to a local/vendor source.

## Proposed Execution Order

1. Sanitize secrets in tracked docs.
2. Move useful docs/scripts into `docs/`.
3. Delete approved generated/local artifacts.
4. Tighten `.gitignore` for `.obsidian/`, local notes, and Python caches if needed.
5. Run `npm run build`.
6. Run `npm run electron:compile`.
7. Re-check `git status --short`.
8. If preparing GitHub, clean Git history for secrets before first push.

## Execution Result - 2026-05-20

Completed:

- Sanitized tracked MT5 credentials in legacy docs by replacing real values with placeholders.
- Moved loose/historical docs into `docs/archive/` and `docs/profitdll/`.
- Moved exploratory options scripts from `python/options/` into `docs/archive/options/manual-checks/`.
- Removed local/generated artifacts:
  - `codex-electron-check/`
  - `codex-electron-check-fixed/`
  - `codex-electron-check-final/`
  - `codex_ws_check.py`
  - `.obsidian/`
  - `2026-05-15.md`
  - `Sem titulo.canvas`
  - `graphify-out/`
  - `agent_workspace/`
  - `models/`
  - Python `__pycache__/` directories
- Merged the legacy `python/options/options_data.db` history into `data/options/options_data.db`.
- Removed the legacy duplicate DB after merge.
- Updated `.gitignore` to ignore Obsidian state, canvas files, and loose daily notes.
- Updated Electron packaging config to include `agents/**/*`, because `/api/agents` uses the root `agents/` pipeline.

Validation:

- `npm run build`: passed.
- `npm run electron:compile`: passed.
- `py_compile` for `scanner_opcoes.py`, `spread_api.py`, `mt5_bridge.py`, `profitdll_bridge.py`, and `volatility_api.py`: passed.
- `data/options/options_data.db`: `integrity ok`, 11 scans, 138 options, 0 orphan options.

Remaining decisions before GitHub:

- Keep `ProfitDLL/` in the repository because it documents how to use the vendor DLL.
- Removed tracked local example folders after user confirmation:
  - `estudo/`
  - `monitoramento_acoes/`
- If the remote must never contain old MT5 credentials, clean local Git history before first push.
