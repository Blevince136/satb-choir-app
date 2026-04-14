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

## Deploy on Render

This backend is ready for Render deployment.

- Build command:
```text
pip install -r requirements.txt
```

- Start command:
```text
python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Required production environment variables:

- `MONGODB_URI` -> your MongoDB Atlas connection string
- `MONGODB_DB_NAME` -> usually `satb_choir_app`
- `API_PREFIX` -> `/api`

Health check:

```text
/api/health
```
