# Solo Development Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converge the unlaunched, single-developer HRM project to one `main` branch and one local Docker `hrm` runtime while preserving all database volumes and keeping LAN access working.

**Architecture:** Treat Git history and Docker data as separate safety boundaries. Stop only the duplicate `kayford-deploy` Compose project without deleting containers or volumes, then remove only the clean `codex/realistic-demo-data` worktree and its branch after proving it has no unique commits. Verify the retained `hrm` Web, API, and database from both localhost and the current WLAN address.

**Tech Stack:** Git worktrees, PowerShell, Docker Desktop, Docker Compose, HTTP health checks.

## Global Constraints

- Keep `main` as the only daily development branch.
- Keep the local Docker Desktop `hrm` Compose project and all five services.
- Never run `docker compose down -v`, `docker volume rm`, or database reset commands.
- Stop, but do not delete, the `kayford-deploy` Compose project resources.
- Preserve the main workspace `tmp/` directory and do not stage it.
- Do not remove the detached worktree at `C:\Users\lwei\AppData\Local\Temp\hrm-prod-deploy-6223a8f`; it is externally managed.
- Do not force-remove a dirty worktree or force-delete a branch.
- Abort cleanup if `codex/realistic-demo-data` has a unique commit or any tracked/untracked non-ignored file.
- Verify HTTP behavior after convergence; container state alone is insufficient.

---

## File Structure

No application or configuration file is changed. The only tracked artifact is this execution plan; runtime state is changed through Git and Docker commands.

### Task 1: Stop the Duplicate Compose Runtime Safely

**Files:**
- Read: `docker-compose.yml`
- Read: `docker-compose.prod.yml`

**Interfaces:**
- Consumes: Docker Compose project `kayford-deploy`, whose container labels name `C:\Users\lwei\Documents\Claude\KeyFord\HRM` as its working directory and the two Compose files above as its configuration.
- Produces: Five stopped `kayford-deploy` containers with their named volumes, images, and data still present; the `hrm` project remains running.

- [ ] **Step 1: Record the two Compose projects and retained service health**

Run from `C:\Users\lwei\Documents\Claude\KeyFord\HRM`:

```powershell
docker compose ls --all
docker ps --filter name=hrm- --format '{{.Names}}|{{.Status}}|{{.Ports}}'
Invoke-WebRequest http://localhost:5173 -UseBasicParsing -TimeoutSec 10
Invoke-WebRequest http://localhost:3000/api/v1/health -UseBasicParsing -TimeoutSec 10
```

Expected: both Compose projects are listed; all five `hrm` containers are running; Web returns `200`; API response contains `"status":"ok"` and `"db":"ok"`.

- [ ] **Step 2: Stop exactly the duplicate project without deleting resources**

Run:

```powershell
docker compose -p kayford-deploy -f docker-compose.yml -f docker-compose.prod.yml stop
```

Expected: the five `kayford-deploy` containers stop successfully. Do not substitute `down`, `down -v`, `rm`, or a volume command.

- [ ] **Step 3: Verify runtime convergence and retained data resources**

Run:

```powershell
docker ps --filter name=kayford-deploy- --format '{{.Names}}|{{.Status}}'
docker ps --filter name=hrm- --format '{{.Names}}|{{.Status}}|{{.Ports}}'
docker ps -a --filter name=kayford-deploy- --format '{{.Names}}|{{.Status}}'
docker volume ls --filter label=com.docker.compose.project=kayford-deploy
```

Expected: no `kayford-deploy` container is running; five stopped containers remain visible with `docker ps -a`; project volumes remain listed; all five `hrm` containers continue running.

### Task 2: Remove the Empty Feature Worktree and Verify the Single-Branch Workflow

**Files:**
- Remove runtime workspace only: `C:\Users\lwei\Documents\Claude\KeyFord\HRM\.worktrees\realistic-demo-data`
- Preserve: `C:\Users\lwei\Documents\Claude\KeyFord\HRM\tmp`

**Interfaces:**
- Consumes: local branch `codex/realistic-demo-data` and its linked worktree.
- Produces: `main` as the only local named development branch; the externally managed detached worktree remains registered; retained Web/API endpoints stay healthy.

- [ ] **Step 1: Prove the feature worktree is disposable**

Run:

```powershell
git -C .worktrees/realistic-demo-data status --porcelain --untracked-files=all
git rev-list --count main..codex/realistic-demo-data
git merge-base --is-ancestor codex/realistic-demo-data main
```

Expected: status output is empty, unique-commit count is `0`, and the ancestry command exits `0`. If any condition differs, stop without removing the worktree or branch.

- [ ] **Step 2: Resolve and validate the exact worktree target**

Run:

```powershell
$repoRoot = [System.IO.Path]::GetFullPath('C:\Users\lwei\Documents\Claude\KeyFord\HRM')
$worktreeRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.worktrees'))
$worktreePath = [System.IO.Path]::GetFullPath((Join-Path $worktreeRoot 'realistic-demo-data'))
if ((Split-Path $worktreePath -Parent) -ne $worktreeRoot) { throw "Unexpected worktree path: $worktreePath" }
git worktree list --porcelain
```

Expected: `$worktreePath` is exactly `C:\Users\lwei\Documents\Claude\KeyFord\HRM\.worktrees\realistic-demo-data` and the list associates it with `codex/realistic-demo-data`.

- [ ] **Step 3: Remove the clean worktree and safely delete its branch**

Run from the main repository root:

```powershell
git worktree remove 'C:\Users\lwei\Documents\Claude\KeyFord\HRM\.worktrees\realistic-demo-data'
git worktree prune
git branch -d codex/realistic-demo-data
```

Expected: removal and safe branch deletion succeed without `--force` or `-D`.

- [ ] **Step 4: Verify Git, Docker, localhost, and LAN end state**

Run:

```powershell
git branch --format='%(refname:short)'
git worktree list --porcelain
git status --short
docker compose ls --all
$webLocal = Invoke-WebRequest http://localhost:5173 -UseBasicParsing -TimeoutSec 10
$webLan = Invoke-WebRequest http://192.168.31.65:5173 -UseBasicParsing -TimeoutSec 10
$api = Invoke-WebRequest http://localhost:3000/api/v1/health -UseBasicParsing -TimeoutSec 10
[pscustomobject]@{ LocalWeb=$webLocal.StatusCode; LanWeb=$webLan.StatusCode; Api=$api.StatusCode; ApiBody=$api.Content }
```

Expected: local named branches contain only `main`; main and the external detached worktree remain registered; `git status --short` contains only `?? tmp/`; `hrm` is the only running Compose project; local Web, LAN Web, and API return `200`; API body reports both application and database `ok`.

---

## Final Verification Checklist

- [ ] `kayford-deploy` has zero running containers but its stopped containers and volumes remain.
- [ ] `hrm` has five running containers.
- [ ] `codex/realistic-demo-data` and its owned `.worktrees/realistic-demo-data` directory are removed without force.
- [ ] `main` is the only local named branch used for development.
- [ ] The externally managed detached worktree is untouched.
- [ ] `tmp/` remains present and untracked.
- [ ] Localhost and current WLAN Web URLs return `200`.
- [ ] API health returns application and database `ok`.
