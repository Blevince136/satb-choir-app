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
3. A later deep-learning model such as `LSTM`, `GRU`, or a small `Transformer` using the same extracted dataset

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
