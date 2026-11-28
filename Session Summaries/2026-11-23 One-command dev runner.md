# One-command dev runner

**What was asked**
A single command that starts the backend and frontend together.

**What changed**
- New `scripts/dev.ps1`: starts uvicorn (`.venv-gru`, fallback `Backend\.venv`, port 8000, reload) in the background and `npm run dev` (Vite) in the foreground; stops both on exit. Params: `-BackendPort`, `-NoReload`. Refuses to start if the backend port is busy; runs `npm install` if `Frontend\node_modules` is missing.
- `package.json` (repo root, was `{}`): added `npm run dev`.
- Run: `npm run dev` from the SignSync folder.

**Decisions and caveats**
- Verified on backend port 8010 (docs returned 200, Vite started, nothing left listening after stop). Servers already running on 8000/5173 were left alone, so Vite fell back to 5174 in the test.
- Ctrl+C cleanup relies on the script's `finally` block; only the forced-stop path was tested.
- Not committed.

**Not done / open**
- README mention; commit and push.
