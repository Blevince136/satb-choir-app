# SATB Choir App

Cloud-ready starter for a **Personalized Choir Vocal Training System** built with:

- `mobile`: Expo React Native singer app
- `frontend`: Next.js
- `backend`: FastAPI
- `database`: MongoDB Atlas
- `future OMR`: Audiveris for scanned score conversion

## Repository structure

- `frontend/` - Next.js web app
- `mobile/` - singer-facing Expo mobile app
- `backend/` - FastAPI API service
- Root prototype files - earlier static MVP kept for reference

## Local development

### Frontend

```powershell
cd frontend
C:\Program Files\nodejs\npm.cmd run dev
```

### Backend

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

### Mobile

```powershell
cd mobile
$env:Path='C:\Program Files\nodejs;' + $env:Path
& 'C:\Program Files\nodejs\npm.cmd' start
```

Backend interface:

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Environment setup

Copy `backend/.env.example` to `backend/.env`, then replace the MongoDB placeholder values with your Atlas connection string and database name.

## Deploy Backend On Render

The easiest free deployment path for Singmobi is:

- `Render` for the FastAPI backend
- `MongoDB Atlas` for the database

This repo now includes [render.yaml](d:\FINAL YEAR PROJECT\satb-choir-app\render.yaml) so Render can create the backend service from source.

### Before you deploy

1. Push your latest code to GitHub
2. Choose a storage mode:
   - `file` for a zero-cost Render demo deployment
   - `mongodb` for a fuller deployment backed by MongoDB Atlas

### Render setup

1. Go to `https://render.com`
2. Create a new Blueprint or Web Service from your GitHub repo
3. If you use the included `render.yaml`, Render will detect:
   - `rootDir`: `backend`
   - `buildCommand`: `pip install -r requirements.txt`
   - `startCommand`: `python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. The included [render.yaml](d:\FINAL YEAR PROJECT\satb-choir-app\render.yaml) currently uses:
   - `STORAGE_BACKEND=file`

This lets you deploy without paying for Atlas right now.

### Zero-cost demo mode

In file-storage mode:

- user accounts
- sessions
- scores metadata
- practice metadata

are stored in backend JSON files on the Render instance.

Important:
- this is good for demos and testing
- it is not durable like a cloud database
- data may be lost when the service is rebuilt or the instance filesystem resets

### Full production mode

If you later want stronger persistence:

1. create a MongoDB Atlas cluster
2. set:
   - `STORAGE_BACKEND=mongodb`
   - `MONGODB_URI=your-atlas-uri`

### After deploy

Your backend URL will look something like:

```text
https://singmobi-backend.onrender.com
```

Test it in a browser:

```text
https://your-render-url.onrender.com/api/health
```

Then point the mobile app to that URL in `mobile/.env`:

```env
EXPO_PUBLIC_API_BASE_URL=https://your-render-url.onrender.com
```

Restart Expo or rebuild the APK after changing the mobile backend URL.

## Current status

- Next.js scaffolded and ready
- Expo mobile singer app scaffolded and styled
- FastAPI scaffolded and ready
- MongoDB Atlas integration wired at config level
- Score-processing endpoints currently mocked so frontend work can continue immediately
- Visible frontend dashboard now connects to the mock FastAPI endpoints
- MusicXML and MIDI uploads now go through a real SATB analysis service in the backend
- PDF uploads are explicitly marked as conversion-required before SATB parsing

## AI / ML pipeline

The project now includes a concrete starting point for the AI contribution in `backend/scripts/`:

- `build_satb_dataset.py` extracts note-level SATB training rows from `MusicXML`, `XML`, `MXL`, `MID`, and `MIDI`
- `train_satb_baseline.py` trains a baseline `RandomForest` classifier for note-to-voice prediction
- `backend/app/ml/dataset.py` contains the reusable feature-extraction logic

This gives you a strong academic path:

1. Rule-based SATB extraction as the baseline
2. Machine-learning SATB classification as the intelligent layer
3. A later deep-learning model such as a neural network, `LSTM`, `GRU`, or a small `Transformer` using the same extracted dataset

### Build a training dataset

Put labeled choir scores into a folder where part names or score structure identify the voice context, then run:

```powershell
cd backend
.\.venv\Scripts\python.exe scripts\build_satb_dataset.py "path\to\training-scores" --output data\satb_note_dataset.csv
```

### Train a baseline ML classifier

```powershell
cd backend
.\.venv\Scripts\python.exe scripts\train_satb_baseline.py data\satb_note_dataset.csv --model-output artifacts\satb_random_forest.joblib
```

This is the recommended first AI milestone before adding a neural-network model.

### Train a neural-network SATB classifier

Install PyTorch first:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pip install torch
```

Then train the neural model:

```powershell
cd backend
.\.venv\Scripts\python.exe scripts\train_satb_neural.py data\satb_note_dataset.csv --model-output artifacts\satb_neural.pt --epochs 30
```

If PyTorch has a local DLL/runtime issue on Windows, the script automatically falls back to a `sklearn` multi-layer perceptron so you still have a working neural-network baseline.
