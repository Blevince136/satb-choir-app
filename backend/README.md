# Backend

FastAPI service for uploads, score processing, SATB extraction workflows, and trainer activity APIs.

## Run locally

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload
```

If PowerShell blocks activation, use:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```
