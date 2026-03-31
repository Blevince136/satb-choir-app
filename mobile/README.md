# Mobile App

Singer-focused mobile application built with Expo React Native.

## Run locally

```powershell
cd mobile
$env:Path='C:\Program Files\nodejs;' + $env:Path
& 'C:\Program Files\nodejs\npm.cmd' start
```

Then choose one of:

- `a` for Android emulator
- `w` for web preview
- Scan the QR code with Expo Go on your phone

## Backend connection note

`App.tsx` currently uses:

- `http://10.0.2.2:8000` for Android emulator access to the local FastAPI backend

If you test on a real phone, replace that host with your computer's local network IP, for example:

- `http://192.168.x.x:8000`
