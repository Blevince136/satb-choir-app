import { StatusBar } from "expo-status-bar";
import { Audio } from "expo-av";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import * as Sharing from "expo-sharing";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type HealthResponse = {
  status: string;
  service: string;
};

type AiStatusResponse = {
  status: string;
  classifier_enabled: boolean;
  model_available: boolean;
  model_backend: string;
  model_path: string;
  note: string;
};

type StorageStatusResponse = {
  backend: string;
  database_name: string;
  migration_version: number | null;
  migration_completed: boolean;
  legacy_json_files_remaining: string[];
  archived_legacy_json_files: string[];
  counts: {
    users: number;
    sessions: number;
    scores: number;
    practice_recordings: number;
  };
};

type Score = {
  id: string;
  title: string;
  composer: string;
  format: string;
  file_name: string;
  file_size: number;
  uploaded_at: string;
  processing_status: string;
  processing_progress: number;
  extraction_accuracy: number;
  stored_path?: string | null;
  audio_cache_ready?: boolean;
  audio_cache_tempo?: number | null;
  analysis?: ScoreAnalysis;
};

type ScoreAnalysis = {
  source_format: string;
  conversion_required: boolean;
  parser_used: string;
  voices: ScoreVoiceSummary[];
  warnings: string[];
};

type ScoreVoiceSummary = {
  voice_part: "Soprano" | "Alto" | "Tenor" | "Bass";
  detected_notes: number;
  average_pitch_midi?: number | null;
  lowest_pitch?: string | null;
  highest_pitch?: string | null;
  confidence: number;
};

type AuthUser = {
  id: string;
  full_name: string;
  email: string;
  created_at: string;
};

type AuthSessionResponse = {
  access_token: string;
  token_type: string;
  user: AuthUser;
};

type PlaybackVoice = "Harmony" | ScoreVoiceSummary["voice_part"];

type PracticeRecordingResult = {
  id: string;
  score_id: string;
  score_title: string;
  voice_part: string;
  recording_uri: string;
  duration_ms: number;
  accuracy_percent: number;
  feedback: string;
  analysis_method: string;
  reference_duration_ms: number;
  recorded_at: string;
};

type VoicePart = {
  name: "Soprano" | "Alto" | "Tenor" | "Bass";
  range: string;
  accent: string;
  tone: string;
};

// For Android emulator: 10.0.2.2 maps to host machine localhost.
// For real phone on same network: set EXPO_API_BASE_URL in app config or replace below with your PC IP.
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  process.env.EXPO_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://10.0.2.2:8000";

const allowedMimeTypes = [
  "application/pdf",
  "application/vnd.recordare.musicxml+xml",
  "application/xml",
  "text/xml",
  "audio/midi",
  "audio/x-midi",
  "application/octet-stream",
];

const voiceParts: VoicePart[] = [
  { name: "Soprano", range: "C4 - A5", accent: "#B74C58", tone: "#F7DFE2" },
  { name: "Alto", range: "G3 - D5", accent: "#C9891A", tone: "#F8E8C6" },
  { name: "Tenor", range: "C3 - G4", accent: "#32779E", tone: "#DDEFF8" },
  { name: "Bass", range: "E2 - C4", accent: "#5C4CA5", tone: "#E4DFF7" },
];

const practiceList = [
  {
    title: "Assigned Song",
    subtitle: "Mwangaza wa Asubuhi | rehearsal target for Friday",
    action: "Open score",
    accent: "#B74C58",
  },
  {
    title: "Trainer Feedback",
    subtitle: "Work on cleaner alto entrance in section B before full tempo.",
    action: "Review notes",
    accent: "#C9891A",
  },
  {
    title: "Today's Goal",
    subtitle: "Complete 20 minutes of solo practice on your selected SATB part.",
    action: "Start session",
    accent: "#32779E",
  },
];

const AUTH_TOKEN_KEY = "singmobi_access_token";
const PREWARM_VOICES: PlaybackVoice[] = ["Harmony", "Soprano", "Alto", "Tenor", "Bass"];

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

const tabs = ["Home", "Library", "Audio", "Practice", "Account"] as const;
const authModes = ["signIn", "signUp"] as const;

type TabKey = (typeof tabs)[number];
type AuthMode = (typeof authModes)[number];

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("signIn");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authToken, setAuthToken] = useState("");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authBootstrapping, setAuthBootstrapping] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("Home");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatusResponse | null>(null);
  const [storageStatus, setStorageStatus] = useState<StorageStatusResponse | null>(null);
  const [apiError, setApiError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [selectedPart, setSelectedPart] = useState<VoicePart["name"]>("Alto");
  const [tempo, setTempo] = useState("92");
  const [progress, setProgress] = useState("78");
  const [scores, setScores] = useState<Score[]>([]);
  const [scoreSearch, setScoreSearch] = useState("");
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signUpName, setSignUpName] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [playbackTempo, setPlaybackTempo] = useState("92");
  const [selectedPlaybackVoice, setSelectedPlaybackVoice] = useState<PlaybackVoice | null>(null);
  const [activePlaybackScoreId, setActivePlaybackScoreId] = useState<string | null>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playingScoreId, setPlayingScoreId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlaybackBusy, setIsPlaybackBusy] = useState(false);
  const [transportState, setTransportState] = useState<"play" | "pause" | "stop">("stop");
  const [playbackPositionMillis, setPlaybackPositionMillis] = useState(0);
  const [playbackDurationMillis, setPlaybackDurationMillis] = useState(0);
  const [editingScoreId, setEditingScoreId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editComposer, setEditComposer] = useState("");
  const [practiceVoice, setPracticeVoice] = useState<PlaybackVoice | null>(null);
  const [practiceScoreId, setPracticeScoreId] = useState<string | null>(null);
  const [practiceRecording, setPracticeRecording] = useState<Audio.Recording | null>(null);
  const [practiceRecordingUri, setPracticeRecordingUri] = useState<string>("");
  const [practiceRecordingDurationMs, setPracticeRecordingDurationMs] = useState(0);
  const [practiceSound, setPracticeSound] = useState<Audio.Sound | null>(null);
  const [isPracticeRecording, setIsPracticeRecording] = useState(false);
  const [isPracticeSubmitting, setIsPracticeSubmitting] = useState(false);
  const [practiceResult, setPracticeResult] = useState<PracticeRecordingResult | null>(null);
  const [practiceRecordings, setPracticeRecordings] = useState<PracticeRecordingResult[]>([]);
  const [isPracticePlaying, setIsPracticePlaying] = useState(false);
  const [activePracticePlaybackId, setActivePracticePlaybackId] = useState<string | null>(null);
  const [preloadedAudioKeys, setPreloadedAudioKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;

    async function fetchHealthAndAi() {
      try {
        const [healthResponse, aiResponse, storageResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/api/health`),
          fetch(`${API_BASE_URL}/api/ai/status`),
          fetch(`${API_BASE_URL}/api/health/storage/status`),
        ]);

        if (!healthResponse.ok) {
          throw new Error(`Status ${healthResponse.status}`);
        }

        const healthData = (await healthResponse.json()) as HealthResponse;
        const aiStatusData = aiResponse.ok
          ? ((await aiResponse.json()) as AiStatusResponse)
          : null;
        const storageData = storageResponse.ok
          ? ((await storageResponse.json()) as StorageStatusResponse)
          : null;
        if (active) {
          setHealth(healthData);
          setAiStatus(aiStatusData);
          setStorageStatus(storageData);
          setApiError("");
        }
      } catch (error) {
        if (active) {
          setApiError(
            error instanceof Error
              ? `${error.message}. If testing on a real phone, replace the API host with your computer's local IP.`
              : "Unable to reach the backend service.",
          );
        }
      }
    }

    void fetchHealthAndAi();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      try {
        const storedToken = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
        if (!storedToken) {
          return;
        }

        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: {
            Authorization: `Bearer ${storedToken}`,
          },
        });

        if (!response.ok) {
          await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
          return;
        }

        const user = (await response.json()) as AuthUser;
        if (active) {
          setAuthToken(storedToken);
          setCurrentUser(user);
          setIsAuthenticated(true);
          setApiError("");
        }
      } catch (error) {
        if (active) {
          setApiError(error instanceof Error ? error.message : "Unable to restore session.");
        }
      } finally {
        if (active) {
          setAuthBootstrapping(false);
        }
      }
    }

    void restoreSession();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    void refreshScores();
    void refreshPracticeRecordings();

    const interval = setInterval(() => {
      void refreshScores();
    }, 3000);

    return () => clearInterval(interval);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const readyScores = scores.filter(
      (score) => score.processing_status === "parsed" && score.audio_cache_ready && score.audio_cache_tempo,
    );

    if (!readyScores.length) {
      return;
    }

    let cancelled = false;

    async function prewarmReadyScores() {
      for (const score of readyScores) {
        const readyTempo = score.audio_cache_tempo ?? 92;
        for (const voice of PREWARM_VOICES) {
          if (cancelled) {
            return;
          }
          try {
            await ensureLocalPlayback(score.id, voice, readyTempo);
          } catch {
            // Leave failures quiet here so preload doesn't disrupt the main UI flow.
          }
        }
      }
    }

    void prewarmReadyScores();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, scores]);

  useEffect(() => {
    return () => {
      if (sound) {
        void sound.unloadAsync();
      }
    };
  }, [sound]);

  useEffect(() => {
    return () => {
      if (practiceSound) {
        void practiceSound.unloadAsync();
      }
    };
  }, [practiceSound]);

  useEffect(() => {
    if (!successMessage) {
      return;
    }

    const timer = setTimeout(() => {
      setSuccessMessage("");
    }, 3000);

    return () => clearTimeout(timer);
  }, [successMessage]);

  const selectedVoice = useMemo(
    () => voiceParts.find((part) => part.name === selectedPart) ?? voiceParts[0],
    [selectedPart],
  );
  const parsedScores = useMemo(
    () => scores.filter((score) => score.processing_status === "parsed"),
    [scores],
  );
  const filteredLibraryScores = useMemo(() => {
    const query = scoreSearch.trim().toLowerCase();
    if (!query) {
      return scores;
    }

    return scores.filter((score) =>
      [score.title, score.composer, score.file_name, score.format]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query)),
    );
  }, [scoreSearch, scores]);
  const activePlaybackScore = useMemo(
    () => parsedScores.find((score) => score.id === activePlaybackScoreId) ?? null,
    [activePlaybackScoreId, parsedScores],
  );
  const activePracticeScore = useMemo(
    () => parsedScores.find((score) => score.id === practiceScoreId) ?? null,
    [practiceScoreId, parsedScores],
  );
  const activePracticeRecording = useMemo(
    () =>
      practiceRecordings.find((recording) => recording.id === activePracticePlaybackId) ??
      (activePracticePlaybackId === "latest-local" && activePracticeScore && practiceVoice
        ? {
            id: "latest-local",
            score_title: activePracticeScore.title,
            voice_part: practiceVoice,
          }
        : null),
    [activePracticePlaybackId, activePracticeScore, practiceRecordings, practiceVoice],
  );

  function authHeaders(): Record<string, string> {
    return authToken
      ? {
          Authorization: `Bearer ${authToken}`,
        }
      : {};
  }

  async function refreshScores() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/scores`, {
        headers: authHeaders(),
      });
      if (!response.ok) {
        throw new Error(`Status ${response.status}`);
      }

      const data = (await response.json()) as Score[];
      setScores(data);
      setApiError("");
    } catch (error) {
      setApiError(
        error instanceof Error ? error.message : "Unable to refresh imported scores.",
      );
    }
  }

  async function refreshPracticeRecordings() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/practice/recordings`, {
        headers: authHeaders(),
      });
      if (!response.ok) {
        throw new Error(`Status ${response.status}`);
      }

      const data = (await response.json()) as PracticeRecordingResult[];
      setPracticeRecordings(data);
    } catch (error) {
      setApiError(
        error instanceof Error ? error.message : "Unable to refresh recorded practice takes.",
      );
    }
  }

  function submitAuth() {
    void submitAuthAsync();
  }

  async function submitAuthAsync() {
    try {
      if (authMode === "signIn") {
        if (!signInEmail.trim() || !signInPassword.trim()) {
          setApiError("Enter your email and password to sign in.");
          return;
        }
      } else if (!signUpName.trim() || !signUpEmail.trim() || !signUpPassword.trim()) {
        setApiError("Complete all sign-up fields before continuing.");
        return;
      }

      setApiError("");
      setIsBusy(true);
      const endpoint = authMode === "signIn" ? "/api/auth/signin" : "/api/auth/signup";
      const payload =
        authMode === "signIn"
          ? {
              email: signInEmail.trim().toLowerCase(),
              password: signInPassword,
            }
          : {
              full_name: signUpName.trim(),
              email: signUpEmail.trim().toLowerCase(),
              password: signUpPassword,
            };

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Authentication failed (${response.status}).`);
      }

      const session = (await response.json()) as AuthSessionResponse;
      await SecureStore.setItemAsync(AUTH_TOKEN_KEY, session.access_token);
      setAuthToken(session.access_token);
      setCurrentUser(session.user);
      setIsAuthenticated(true);
      setActiveTab("Home");
      setApiError("");
      await refreshScores();
      setSuccessMessage(
        authMode === "signIn"
          ? "Welcome back. Your saved scores are ready in your library."
          : "Account created successfully. Your library will stay with this account.",
      );
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to complete authentication.");
    } finally {
      setIsBusy(false);
    }
  }

  async function importScore() {
    try {
      setApiError("");
      setSuccessMessage("");
      setIsBusy(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: allowedMimeTypes,
        multiple: false,
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];
      const uploadResult = await withTimeout(
        FileSystem.uploadAsync(`${API_BASE_URL}/api/scores`, asset.uri, {
          fieldName: "file",
          httpMethod: "POST",
          headers: authHeaders(),
          mimeType: asset.mimeType ?? "application/octet-stream",
          parameters: {
            title: asset.name.replace(/\.[^/.]+$/, ""),
            composer: "Singer mobile upload",
          },
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        }),
        60000,
        "Upload timed out. Check backend connection and try again.",
      );

      if (uploadResult.status !== 200) {
        throw new Error(uploadResult.body || `Upload failed with status ${uploadResult.status}`);
      }

      await refreshScores();
      setSuccessMessage("Score uploaded successfully. It is now stored in your library.");
    } catch (error) {
      setApiError(
        error instanceof Error
          ? `${error.message}. On a real Android phone, import files after copying them from your computer to the phone.`
          : "Unable to import the selected score.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function searchScoresOnline() {
    try {
      const query = scoreSearch.trim();
      if (!query) {
        setApiError("Type a score title first, then use online search.");
        return;
      }

      const url = `https://www.google.com/search?q=${encodeURIComponent(
        `${query} sheet music pdf musicxml midi`,
      )}`;
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        throw new Error("Online score search is not available on this device.");
      }

      await Linking.openURL(url);
    } catch (error) {
      setApiError(
        error instanceof Error ? error.message : "Unable to open online score search.",
      );
    }
  }

  async function parseScore(scoreId: string) {
    try {
      setApiError("");
      setSuccessMessage("");
      const response = await fetch(`${API_BASE_URL}/api/scores/${scoreId}/parse`, {
        method: "POST",
        headers: authHeaders(),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Parse failed with status ${response.status}`);
      }

      await refreshScores();
      setSuccessMessage("Parsing has started successfully for this score.");
    } catch (error) {
      setApiError(
        error instanceof Error ? error.message : "Unable to start score parsing.",
      );
    }
  }

  function localPlaybackPath(scoreId: string, voicePart: PlaybackVoice, tempo: number) {
    const targetDirectory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
    if (!targetDirectory) {
      throw new Error("No local storage is available for playback.");
    }
    return `${targetDirectory}playback-${scoreId}-${voicePart.toLowerCase()}-${tempo}.wav`;
  }

  async function ensureLocalPlayback(
    scoreId: string,
    voicePart: PlaybackVoice,
    tempo: number,
  ) {
    const targetPath = localPlaybackPath(scoreId, voicePart, tempo);
    const cacheKey = `${scoreId}:${voicePart}:${tempo}`;
    const existing = await FileSystem.getInfoAsync(targetPath);
    if (existing.exists) {
      setPreloadedAudioKeys((current) => (current[cacheKey] ? current : { ...current, [cacheKey]: true }));
      return targetPath;
    }

    const downloadResult = await FileSystem.downloadAsync(
      `${API_BASE_URL}/api/scores/${scoreId}/playback?voice_part=${voicePart}&tempo=${tempo}`,
      targetPath,
      {
        headers: authHeaders(),
      },
    );

    if (downloadResult.status !== 200) {
      throw new Error(`Playback download failed (${downloadResult.status}).`);
    }

    const downloadedInfo = await FileSystem.getInfoAsync(downloadResult.uri);
    if (!downloadedInfo.exists) {
      throw new Error("Playback file could not be found on the device.");
    }
    if ("size" in downloadedInfo && typeof downloadedInfo.size === "number" && downloadedInfo.size <= 44) {
      throw new Error("Playback file is empty.");
    }

    setPreloadedAudioKeys((current) => ({ ...current, [cacheKey]: true }));
    return downloadResult.uri;
  }

  async function playVoice(scoreId: string, voicePart: PlaybackVoice) {
    try {
      setApiError("");
      setIsPlaybackBusy(true);
      setTransportState("play");
      if (sound) {
        await sound.unloadAsync();
      }
      if (practiceSound) {
        await practiceSound.unloadAsync();
        setPracticeSound(null);
        setActivePracticePlaybackId(null);
        setIsPracticePlaying(false);
      }

      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

      const selectedTempo = Number.parseInt(playbackTempo, 10) || 92;
      const playbackUri = await ensureLocalPlayback(scoreId, voicePart, selectedTempo);

      const { sound: nextSound } = await Audio.Sound.createAsync(
        {
          uri: playbackUri,
        },
        { shouldPlay: true, volume: 1.0, progressUpdateIntervalMillis: 250 },
      );
      await nextSound.setVolumeAsync(1.0);
      await nextSound.playAsync();

      nextSound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) {
          return;
        }

        setIsPlaying(status.isPlaying ?? false);
        setPlaybackPositionMillis(status.positionMillis ?? 0);
        setPlaybackDurationMillis(status.durationMillis ?? 0);
        if (status.didJustFinish) {
          setPlayingScoreId(null);
          setPlaybackPositionMillis(0);
          setTransportState("stop");
        }
      });

      setSelectedPlaybackVoice(voicePart);
      setActivePlaybackScoreId(scoreId);
      setPlayingScoreId(scoreId);
      setIsPlaying(true);
      setSound(nextSound);
    } catch (error) {
      setApiError(
        error instanceof Error ? error.message : "Unable to play the selected voice.",
      );
    } finally {
      setIsPlaybackBusy(false);
    }
  }

  async function pausePlayback() {
    if (!sound) {
      return;
    }
    await sound.pauseAsync();
    setIsPlaying(false);
    setTransportState("pause");
  }

  async function resumePlayback() {
    if (!sound) {
      return;
    }
    await sound.playAsync();
    setIsPlaying(true);
    setTransportState("play");
  }

  async function stopPlayback() {
    if (!sound) {
      return;
    }
    await sound.stopAsync();
    await sound.unloadAsync();
    setSound(null);
    setPlayingScoreId(null);
    setIsPlaying(false);
    setPlaybackPositionMillis(0);
    setPlaybackDurationMillis(0);
    setTransportState("stop");
  }

  function nudgePlaybackTempo(delta: number) {
    const currentTempo = Number.parseInt(playbackTempo, 10);
    const baseTempo = Number.isFinite(currentTempo) ? currentTempo : 92;
    const nextTempo = Math.max(40, Math.min(180, baseTempo + delta));
    setPlaybackTempo(String(nextTempo));
  }

  async function seekPlayback(deltaMillis: number) {
    if (!sound) {
      return;
    }

    const nextPosition = Math.max(
      0,
      Math.min(playbackDurationMillis || 0, playbackPositionMillis + deltaMillis),
    );
    await sound.setPositionAsync(nextPosition);
    setPlaybackPositionMillis(nextPosition);
  }

  function beginEditingScore(score: Score) {
    setEditingScoreId(score.id);
    setEditTitle(score.title);
    setEditComposer(score.composer);
  }

  async function saveScoreChanges(scoreId: string) {
    try {
      setApiError("");
      setSuccessMessage("");
      const response = await fetch(`${API_BASE_URL}/api/scores/${scoreId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          title: editTitle.trim(),
          composer: editComposer.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error(`Unable to save changes (${response.status}).`);
      }

      setEditingScoreId(null);
      await refreshScores();
      setSuccessMessage("Score details updated successfully.");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to save score changes.");
    }
  }

  function confirmRemoveScore(scoreId: string, scoreTitle: string) {
    Alert.alert(
      "Delete score?",
      `Are you sure you want to delete "${scoreTitle}"? This will remove the stored score and its generated files from your library.`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void removeScore(scoreId);
          },
        },
      ],
    );
  }

  async function removeScore(scoreId: string) {
    try {
      setApiError("");
      setSuccessMessage("");
      const response = await fetch(`${API_BASE_URL}/api/scores/${scoreId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!response.ok) {
        throw new Error(`Unable to delete score (${response.status}).`);
      }

      if (playingScoreId === scoreId) {
        await stopPlayback();
      }
      await refreshScores();
      setSuccessMessage("Score deleted successfully.");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to delete score.");
    }
  }

  async function exportVoice(
    scoreId: string,
    voicePart: PlaybackVoice,
    exportFormat: "audio" | "musicxml" | "midi",
  ) {
    try {
      setApiError("");
      setSuccessMessage("");
      const extensionMap = {
        audio: "wav",
        musicxml: "musicxml",
        midi: "mid",
      } as const;
      const score = scores.find((item) => item.id === scoreId);
      const titleSegment = sanitizeFileNameSegment(score?.title ?? scoreId);
      const voiceSegment = sanitizeFileNameSegment(voicePart.toLowerCase());
      const targetDirectory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
      if (!targetDirectory) {
        throw new Error("No writable storage directory is available for export.");
      }
      const targetPath = `${targetDirectory}${titleSegment}-${voiceSegment}.${extensionMap[exportFormat]}`;
      const downloadResult = await FileSystem.downloadAsync(
        `${API_BASE_URL}/api/scores/${scoreId}/export?voice_part=${voicePart}&format=${exportFormat}&tempo=${encodeURIComponent(playbackTempo)}`,
        targetPath,
        {
          headers: authHeaders(),
        },
      );
      if (downloadResult.status !== 200) {
        throw new Error(`Unable to export ${exportFormat} (${downloadResult.status}).`);
      }
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(downloadResult.uri, {
          dialogTitle: `Export ${voicePart} ${exportFormat.toUpperCase()}`,
          mimeType:
            exportFormat === "audio"
              ? "audio/wav"
              : exportFormat === "midi"
                ? "audio/midi"
                : "application/vnd.recordare.musicxml+xml",
          UTI:
            exportFormat === "audio"
              ? "public.wave-audio"
              : exportFormat === "midi"
                ? "public.midi-audio"
                : "public.xml",
        });
      }
      setSuccessMessage(`${voicePart} ${exportFormat.toUpperCase()} exported successfully.`);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to export voice file.");
    }
  }

  async function startPracticeRecording() {
    try {
      if (!practiceScoreId || !practiceVoice) {
        setApiError("Select a parsed score and voice before recording practice.");
        return;
      }

      setApiError("");
      setPracticeResult(null);
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        throw new Error("Microphone permission is required for practice recording.");
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setPracticeRecording(recording);
      setPracticeRecordingUri("");
      setPracticeRecordingDurationMs(0);
      setIsPracticeRecording(true);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to start practice recording.");
    }
  }

  async function stopPracticeRecording() {
    if (!practiceRecording) {
      return;
    }

    try {
      await practiceRecording.stopAndUnloadAsync();
      const status = await practiceRecording.getStatusAsync();
      const uri = practiceRecording.getURI() ?? "";
      setPracticeRecordingUri(uri);
      setPracticeRecordingDurationMs("durationMillis" in status ? status.durationMillis ?? 0 : 0);
      setIsPracticeRecording(false);
      setPracticeRecording(null);
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to stop practice recording.");
    }
  }

  async function playPracticeRecording() {
    try {
      if (!practiceRecordingUri) {
        setApiError("Record a practice take first.");
        return;
      }

      if (sound) {
        await sound.unloadAsync();
        setSound(null);
        setPlayingScoreId(null);
        setIsPlaying(false);
        setPlaybackPositionMillis(0);
        setPlaybackDurationMillis(0);
        setTransportState("stop");
      }
      if (practiceSound) {
        await practiceSound.unloadAsync();
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

      const { sound: nextPracticeSound } = await Audio.Sound.createAsync(
        { uri: practiceRecordingUri },
        { shouldPlay: true, volume: 1.0 },
      );
      nextPracticeSound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) {
          return;
        }
        setIsPracticePlaying(status.isPlaying ?? false);
        if (status.didJustFinish) {
          setActivePracticePlaybackId(null);
          setIsPracticePlaying(false);
        }
      });
      setPracticeSound(nextPracticeSound);
      setActivePracticePlaybackId("latest-local");
      setIsPracticePlaying(true);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to replay the practice recording.");
    }
  }

  async function playSavedPracticeRecording(recording: PracticeRecordingResult) {
    try {
      if (sound) {
        await sound.unloadAsync();
        setSound(null);
        setPlayingScoreId(null);
        setIsPlaying(false);
        setPlaybackPositionMillis(0);
        setPlaybackDurationMillis(0);
        setTransportState("stop");
      }
      if (practiceSound) {
        await practiceSound.unloadAsync();
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

      const targetDirectory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!targetDirectory) {
        throw new Error("No local storage available for practice playback.");
      }

      const downloadTarget = `${targetDirectory}practice-${recording.id}.m4a`;
      const downloadResult = await FileSystem.downloadAsync(
        `${API_BASE_URL}/api/practice/recordings/${recording.id}/audio`,
        downloadTarget,
        { headers: authHeaders() },
      );

      if (downloadResult.status !== 200) {
        throw new Error(`Unable to load saved take (${downloadResult.status}).`);
      }

      const { sound: nextPracticeSound } = await Audio.Sound.createAsync(
        { uri: downloadResult.uri },
        { shouldPlay: true, volume: 1.0 },
      );
      nextPracticeSound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) {
          return;
        }
        setIsPracticePlaying(status.isPlaying ?? false);
        if (status.didJustFinish) {
          setActivePracticePlaybackId(null);
          setIsPracticePlaying(false);
        }
      });
      setPracticeSound(nextPracticeSound);
      setActivePracticePlaybackId(recording.id);
      setIsPracticePlaying(true);
    } catch (error) {
      setApiError(
        error instanceof Error ? error.message : "Unable to play the saved practice take.",
      );
    }
  }

  async function pausePracticePlayback() {
    if (!practiceSound) {
      return;
    }

    await practiceSound.pauseAsync();
    setIsPracticePlaying(false);
  }

  async function stopPracticePlayback() {
    if (!practiceSound) {
      return;
    }

    await practiceSound.stopAsync();
    await practiceSound.unloadAsync();
    setPracticeSound(null);
    setActivePracticePlaybackId(null);
    setIsPracticePlaying(false);
  }

  async function deletePracticeRecording(recordingId: string) {
    try {
      setApiError("");
      setSuccessMessage("");
      const response = await fetch(`${API_BASE_URL}/api/practice/recordings/${recordingId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Unable to delete recording (${response.status}).`);
      }

      if (activePracticePlaybackId === recordingId && practiceSound) {
        await practiceSound.stopAsync();
        await practiceSound.unloadAsync();
        setPracticeSound(null);
        setActivePracticePlaybackId(null);
        setIsPracticePlaying(false);
      }

      await refreshPracticeRecordings();
      setSuccessMessage("Recorded voice deleted successfully.");
    } catch (error) {
      setApiError(
        error instanceof Error ? error.message : "Unable to delete the recorded voice.",
      );
    }
  }

  function confirmDeletePracticeRecording(recording: PracticeRecordingResult) {
    Alert.alert(
      "Delete recorded voice?",
      `Are you sure you want to delete the saved take for "${recording.score_title}" (${recording.voice_part})?`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deletePracticeRecording(recording.id);
          },
        },
      ],
    );
  }

  async function submitPracticeRecording() {
    try {
      if (!practiceScoreId || !practiceVoice || !practiceRecordingUri) {
        setApiError("Choose a parsed score, voice, and record a take before analysis.");
        return;
      }

      setApiError("");
      setIsPracticeSubmitting(true);
      const uploadResult = await withTimeout(
        FileSystem.uploadAsync(`${API_BASE_URL}/api/practice/recordings`, practiceRecordingUri, {
          fieldName: "file",
          httpMethod: "POST",
          headers: authHeaders(),
          mimeType: "audio/mp4",
          parameters: {
            score_id: practiceScoreId,
            voice_part: practiceVoice,
            duration_ms: String(practiceRecordingDurationMs),
            tempo: playbackTempo,
          },
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        }),
        60000,
        "Practice upload timed out. Check backend connection and try again.",
      );

      if (uploadResult.status !== 200) {
        throw new Error(uploadResult.body || `Practice analysis failed (${uploadResult.status}).`);
      }

      const result = JSON.parse(uploadResult.body) as PracticeRecordingResult;
      setPracticeResult(result);
      await refreshPracticeRecordings();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to analyze the practice recording.");
    } finally {
      setIsPracticeSubmitting(false);
    }
  }

  if (authBootstrapping) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <View style={[styles.container, { justifyContent: "center", flex: 1 }]}>
          <View style={styles.formCard}>
            <ActivityIndicator size="large" color="#F2B84B" />
            <Text style={styles.listCardText}>Restoring your Singmobi session...</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <KeyboardAvoidingView
          style={styles.keyboardWrap}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.heroCard}>
            <MusicHeroArt />
            <Text style={styles.eyebrow}>Singer Access</Text>
            <Text style={styles.heroTitle}>Welcome to Singmobi.</Text>
            <Text style={styles.heroText}>
              Practice your choir line with a score-first mobile experience. Start by creating an account or
              signing in, then move through the tabs for practice, scores, and account details.
            </Text>
          </View>

          <View style={styles.authToggleRow}>
            {authModes.map((mode) => {
              const active = authMode === mode;
              return (
                <Pressable
                  key={mode}
                  onPress={() => setAuthMode(mode)}
                  style={[styles.authToggle, active ? styles.authToggleActive : null]}
                >
                  <Text style={[styles.authToggleLabel, active ? styles.authToggleLabelActive : null]}>
                    {mode === "signIn" ? "Sign In" : "Sign Up"}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.formCard}>
            {authMode === "signIn" ? (
              <>
                <Text style={styles.sectionTitle}>Welcome back</Text>
                <AuthInput label="Email address" value={signInEmail} onChangeText={setSignInEmail} />
                <AuthInput
                  label="Password"
                  value={signInPassword}
                  onChangeText={setSignInPassword}
                  secureTextEntry
                />
              </>
            ) : (
              <>
                <Text style={styles.sectionTitle}>Create singer account</Text>
                <AuthInput label="Full name" value={signUpName} onChangeText={setSignUpName} />
                <AuthInput label="Email address" value={signUpEmail} onChangeText={setSignUpEmail} />
                <AuthInput
                  label="Password"
                  value={signUpPassword}
                  onChangeText={setSignUpPassword}
                  secureTextEntry
                />
              </>
            )}

            {apiError ? (
              <View style={styles.inlineError}>
                <Text style={styles.errorText}>{apiError}</Text>
              </View>
            ) : null}

            <Pressable style={styles.primaryButton} onPress={submitAuth}>
              <Text style={styles.primaryButtonLabel}>
                {authMode === "signIn" ? "Sign In" : "Create Account"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.keyboardWrap}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.heroCard}>
          <View style={styles.heroOverlayOne} />
          <View style={styles.heroOverlayTwo} />
          <MusicHeroArt />
          <Text style={styles.eyebrowDark}>Singmobi</Text>
          <Text style={styles.heroTitleDark}>Practice your choir part with a music-first mobile studio.</Text>
          <Text style={styles.heroTextDark}>
            A singer-focused choir app with score parsing, stored tune playback, SATB exports, and a cleaner audio workflow.
          </Text>
          <View style={styles.heroStatsRow}>
            <View style={styles.heroStatCard}>
              <Text style={styles.heroStatLabel}>Practice</Text>
              <Text style={styles.heroStatValue}>{progress}%</Text>
            </View>
            <View style={styles.heroStatCard}>
              <Text style={styles.heroStatLabel}>Tempo</Text>
              <Text style={styles.heroStatValue}>{tempo}%</Text>
            </View>
            <View style={styles.heroStatCard}>
              <Text style={styles.heroStatLabel}>Scores</Text>
              <Text style={styles.heroStatValue}>{scores.length}</Text>
            </View>
          </View>
          <View style={styles.statusRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeLabel}>{health ? "System ready" : "Checking system"}</Text>
            </View>
            <View style={[styles.badge, styles.badgeSoft]}>
              <Text style={styles.badgeLabelSoft}>Selected part: {selectedPart}</Text>
            </View>
            {aiStatus ? (
              <View style={[styles.badge, styles.badgeAi]}>
                <Text style={styles.badgeLabel}>Smart analysis active</Text>
              </View>
            ) : null}
          </View>
        </View>

        {apiError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Notice</Text>
            <Text style={styles.errorText}>{getFriendlyMessage(apiError)}</Text>
          </View>
        ) : null}

        {successMessage ? (
          <View style={styles.successCard}>
            <Text style={styles.successTitle}>Success</Text>
            <Text style={styles.successText}>{successMessage}</Text>
          </View>
        ) : null}

        <View style={styles.tabsRow}>
          {tabs.map((tab) => {
            const active = activeTab === tab;
            return (
              <Pressable
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={[styles.tabButton, active ? styles.tabButtonActive : null]}
              >
                <Text style={[styles.tabButtonLabel, active ? styles.tabButtonLabelActive : null]}>
                  {tab}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {activeTab === "Home" ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>My Rehearsal</Text>
              <Text style={styles.sectionTitle}>Singer overview</Text>
              <View style={styles.summaryGrid}>
                <SummaryCard label="Practice Score" value={`${progress}%`} note="current completion" />
                <SummaryCard label="Parsed Scores" value={`${parsedScores.length}`} note="ready for playback" />
                <SummaryCard label="Library" value={`${scores.length}`} note="uploaded score files" />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Assigned Work</Text>
              <Text style={styles.sectionTitle}>What the singer sees today</Text>
              <View style={styles.stack}>
                {practiceList.map((item) => (
                  <View key={item.title} style={styles.listCard}>
                    <View style={[styles.listAccent, { backgroundColor: item.accent }]} />
                    <View style={styles.listCardCopy}>
                      <Text style={styles.listCardTitle}>{item.title}</Text>
                      <Text style={styles.listCardText}>{item.subtitle}</Text>
                    </View>
                    <Pressable style={styles.ghostButton}>
                      <Text style={styles.ghostButtonLabel}>{item.action}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </View>

          </>
        ) : null}

        {activeTab === "Library" ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Score Library</Text>
            <Text style={styles.sectionTitle}>Upload, parse, and organize score files</Text>
            <View style={styles.controlsCard}>
              <Text style={styles.listCardText}>
                Upload PDF, MIDI, or MusicXML files here, parse them into stored tunes, and manage their details before or
                after parsing.
              </Text>
              <Text style={styles.inputLabel}>Find a score</Text>
              <View style={styles.searchRow}>
                <TextInput
                  value={scoreSearch}
                  onChangeText={setScoreSearch}
                  style={[styles.input, styles.searchInput]}
                  placeholder="Search your library or type a score to search online"
                  placeholderTextColor="#6F87A5"
                />
                <Pressable style={styles.searchButton} onPress={() => void searchScoresOnline()}>
                  <Text style={styles.searchButtonLabel}>Online</Text>
                </Pressable>
              </View>
              <Pressable style={styles.primaryButton} onPress={importScore} disabled={isBusy}>
                {isBusy ? (
                  <View style={styles.buttonBusyRow}>
                    <ActivityIndicator size="small" color="#07111F" />
                    <Text style={styles.primaryButtonLabelDark}>Importing...</Text>
                  </View>
                ) : (
                  <Text style={styles.primaryButtonLabelDark}>Import PDF, MIDI, or MusicXML</Text>
                )}
              </Pressable>
            </View>
            <View style={styles.stack}>
              {scores.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.listCardText}>
                    No imported scores yet. Add a PDF, MIDI, or MusicXML file to see it here.
                  </Text>
                </View>
              ) : filteredLibraryScores.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.listCardText}>
                    No scores matched your search. Try another title, composer, file name, or format.
                  </Text>
                </View>
              ) : (
                filteredLibraryScores.map((score) => (
                  <View key={score.id} style={styles.listCard}>
                    <View style={styles.listCardCopy}>
                      {editingScoreId === score.id ? (
                        <View style={styles.stack}>
                          <TextInput
                            value={editTitle}
                            onChangeText={setEditTitle}
                            style={styles.input}
                            placeholder="Score title"
                            placeholderTextColor="#6F87A5"
                          />
                          <TextInput
                            value={editComposer}
                            onChangeText={setEditComposer}
                            style={styles.input}
                            placeholder="Composer"
                            placeholderTextColor="#6F87A5"
                          />
                        </View>
                      ) : (
                        <>
                          <Text style={styles.listCardTitle}>{score.title}</Text>
                          <Text style={styles.listCardText}>
                            {score.composer} | {score.format} | {score.file_name}
                          </Text>
                        </>
                      )}
                      <Text style={styles.listCardText}>
                        {formatFileSize(score.file_size)} | {new Date(score.uploaded_at).toLocaleString()}
                      </Text>
                      <View style={styles.statusPanel}>
                        <View style={styles.statusRowInline}>
                          <View style={styles.statusChip}>
                            <Text style={styles.statusChipLabel}>
                              {formatStatus(score.processing_status)}
                            </Text>
                          </View>
                          <Text style={styles.statusPercentLabel}>
                            {score.processing_progress}%
                          </Text>
                        </View>
                        <View style={styles.progressTrack}>
                          <View
                            style={[
                              styles.progressFill,
                              { width: `${Math.max(score.processing_progress, 6)}%` },
                            ]}
                          />
                        </View>
                      <Text style={styles.listCardText}>
                        {score.processing_status === "needs_conversion"
                            ? "PDF conversion to MusicXML is still required before SATB parsing."
                            : score.analysis
                              ? `Accuracy ${score.extraction_accuracy}%`
                              : "Stored in system. Parsing has not started yet."}
                      </Text>
                    </View>
                    {score.analysis ? (
                      <View style={styles.analysisBlock}>
                          <View style={styles.analysisChips}>
                            {score.analysis.voices.map((voice) => (
                              <View key={`${score.id}-${voice.voice_part}`} style={styles.analysisChip}>
                                <Text style={styles.analysisChipTitle}>
                                  {voice.voice_part} {voice.detected_notes}
                                </Text>
                                <Text style={styles.analysisChipText}>
                                  Confidence {voice.confidence}%
                                </Text>
                                {voice.lowest_pitch && voice.highest_pitch ? (
                                  <Text style={styles.analysisChipText}>
                                    {voice.lowest_pitch} to {voice.highest_pitch}
                                  </Text>
                                ) : null}
                              </View>
                            ))}
                          </View>
                          {score.analysis.warnings.length ? (
                            <Text style={styles.listCardText}>
                              Some score details still need review before the cleanest playback.
                            </Text>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.scoreActions}>
                      {editingScoreId === score.id ? (
                        <Pressable style={styles.ghostButton} onPress={() => void saveScoreChanges(score.id)}>
                          <Text style={styles.ghostButtonLabel}>Save</Text>
                        </Pressable>
                      ) : (
                        <Pressable style={styles.ghostButton} onPress={() => beginEditingScore(score)}>
                          <Text style={styles.ghostButtonLabel}>Edit</Text>
                        </Pressable>
                      )}
                      <Pressable
                        style={[
                          styles.ghostButton,
                          score.processing_status === "parsing" ||
                          score.processing_status === "queued" ||
                          score.processing_status === "needs_conversion"
                            ? styles.disabledButton
                            : null,
                        ]}
                        onPress={() => void parseScore(score.id)}
                        disabled={
                          score.processing_status === "parsing" ||
                          score.processing_status === "queued" ||
                          score.processing_status === "needs_conversion"
                        }
                      >
                        <Text style={styles.ghostButtonLabel}>
                          {score.processing_status === "parsed"
                            ? "Parse Again"
                            : score.processing_status === "needs_conversion"
                              ? "Needs MusicXML"
                            : score.processing_status === "parsing" || score.processing_status === "queued"
                              ? "Parsing..."
                              : "Parse Score"}
                        </Text>
                      </Pressable>
                      <Pressable
                        style={styles.ghostButton}
                        onPress={() => confirmRemoveScore(score.id, score.title)}
                      >
                        <Text style={styles.ghostButtonLabel}>Delete</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </View>
          </View>
        ) : null}

        {activeTab === "Audio" ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Audio Library</Text>
            <Text style={styles.sectionTitle}>Play stored tunes and export them</Text>
            <View style={styles.stack}>
              {parsedScores.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.listCardText}>
                    No parsed scores yet. Parse a score from the Library tab first so its audio can be stored here.
                  </Text>
                </View>
              ) : (
                parsedScores.map((score) => (
                  <View key={`parsed-${score.id}`} style={styles.listCard}>
                    <View style={styles.listCardCopy}>
                      <Text style={styles.listCardTitle}>{score.title}</Text>
                      <Text style={styles.listCardText}>{score.composer}</Text>
                      <Text style={styles.analysisMeta}>
                        {score.audio_cache_ready && score.audio_cache_tempo
                          ? `Stored audio ready at ${score.audio_cache_tempo} BPM`
                          : "Stored tune not ready yet. Re-parse from Library to generate it."}
                      </Text>
                      <View style={styles.voiceButtonRow}>
                        <Pressable
                          style={[
                            styles.voiceSelectButton,
                            activePlaybackScoreId === score.id && selectedPlaybackVoice === "Harmony"
                              ? styles.voiceSelectButtonActive
                              : styles.voiceSelectButtonInactive,
                          ]}
                          onPress={() => {
                            setActivePlaybackScoreId(score.id);
                            setSelectedPlaybackVoice("Harmony");
                          }}
                        >
                          <Text
                            style={[
                              styles.voiceSelectButtonLabel,
                              activePlaybackScoreId === score.id && selectedPlaybackVoice === "Harmony"
                                ? styles.voiceSelectButtonLabelActive
                                : null,
                            ]}
                          >
                            Harmony
                          </Text>
                        </Pressable>
                        {score.analysis?.voices
                          .filter((voice) => voice.detected_notes > 0)
                          .map((voice) => {
                            const activeVoice =
                              activePlaybackScoreId === score.id && selectedPlaybackVoice === voice.voice_part;
                            return (
                              <Pressable
                                key={`${score.id}-scores-${voice.voice_part}`}
                                style={[
                                  styles.voiceSelectButton,
                                  activeVoice ? styles.voiceSelectButtonActive : styles.voiceSelectButtonInactive,
                                ]}
                                onPress={() =>
                                  {
                                    setActivePlaybackScoreId(score.id);
                                    setSelectedPlaybackVoice(voice.voice_part);
                                  }
                                }
                              >
                                <Text
                                  style={[
                                    styles.voiceSelectButtonLabel,
                                    activeVoice ? styles.voiceSelectButtonLabelActive : null,
                                  ]}
                                >
                                  {voice.voice_part}
                                </Text>
                              </Pressable>
                            );
                          })}
                      </View>
                      <Text style={styles.listCardText}>
                        {activePlaybackScore?.id === score.id
                          ? `Selected for audio playback/export: ${selectedPlaybackVoice ?? "Choose a voice"}`
                          : "Tap a voice above to load this stored tune into the audio console."}
                      </Text>
                    </View>
                  </View>
                ))
              )}
              {activePlaybackScore ? (
                <View style={styles.playbackCard}>
                  <View style={styles.playbackHeader}>
                    <View>
                      <Text style={styles.analysisMeta}>Shared Audio Console</Text>
                      <Text style={styles.playbackTitle}>{activePlaybackScore.title}</Text>
                      <Text style={styles.analysisMeta}>
                        {activePlaybackScore.audio_cache_ready && activePlaybackScore.audio_cache_tempo
                          ? `Preloaded audio ready at ${activePlaybackScore.audio_cache_tempo} BPM. Other tempos generate on demand.`
                          : "Audio will be prepared after parsing and reused for faster playback."}
                      </Text>
                    </View>
                    <View style={styles.playbackPill}>
                      <Text style={styles.playbackPillLabel}>
                        {selectedPlaybackVoice ?? "Pick Voice"}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.playbackProgressPanel}>
                    <View style={styles.playbackProgressHeader}>
                      <Text style={styles.transportTitle}>Playback Position</Text>
                      <Text style={styles.transportSubtitle}>
                        {formatDuration(playbackPositionMillis)} / {formatDuration(playbackDurationMillis)}
                      </Text>
                    </View>
                    <View style={styles.playbackTimelineTrack}>
                      <View
                        style={[
                          styles.playbackTimelineFill,
                          {
                            width: `${Math.max(
                              4,
                              Math.min(
                                100,
                                playbackDurationMillis > 0
                                  ? (playbackPositionMillis / playbackDurationMillis) * 100
                                  : 0,
                              ),
                            )}%`,
                          },
                        ]}
                      />
                    </View>
                    <View style={styles.timelineNudgeRow}>
                      <Pressable style={styles.timelineNudgeButton} onPress={() => void seekPlayback(-15000)}>
                        <Text style={styles.timelineNudgeLabel}>-15s</Text>
                      </Pressable>
                      <Pressable style={styles.timelineNudgeButton} onPress={() => void seekPlayback(-5000)}>
                        <Text style={styles.timelineNudgeLabel}>-5s</Text>
                      </Pressable>
                      <Pressable style={styles.timelineNudgeButton} onPress={() => void seekPlayback(5000)}>
                        <Text style={styles.timelineNudgeLabel}>+5s</Text>
                      </Pressable>
                      <Pressable style={styles.timelineNudgeButton} onPress={() => void seekPlayback(15000)}>
                        <Text style={styles.timelineNudgeLabel}>+15s</Text>
                      </Pressable>
                    </View>
                  </View>
                  <View style={styles.transportPanel}>
                    <View style={styles.transportHeader}>
                      <Text style={styles.transportTitle}>Transport</Text>
                      <Text style={styles.transportSubtitle}>
                        {isPlaybackBusy
                          ? `Preparing ${selectedPlaybackVoice ?? "selected"} audio`
                          : selectedPlaybackVoice
                          ? `${selectedPlaybackVoice} ready on piano`
                          : "Select a voice from the score card above"}
                      </Text>
                    </View>
                    <View style={styles.transportRow}>
                      <Pressable
                        style={[
                          styles.transportButton,
                          transportState === "play" ? styles.transportButtonPrimary : styles.transportButtonMuted,
                        ]}
                        disabled={isPlaybackBusy}
                        onPress={() => {
                          const activeVoice = selectedPlaybackVoice;
                          if (activeVoice) {
                            void playVoice(activePlaybackScore.id, activeVoice);
                          } else {
                            setApiError("Select a voice first before playing.");
                          }
                        }}
                      >
                        <Text style={styles.transportIcon}>{isPlaybackBusy ? "..." : "PLAY"}</Text>
                        <Text
                          style={
                            transportState === "play"
                              ? styles.transportButtonLabelPrimary
                              : styles.transportButtonLabel
                          }
                        >
                          {isPlaybackBusy ? "Loading" : "Play"}
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.transportButton,
                          transportState === "pause" ? styles.transportButtonPrimary : styles.transportButtonMuted,
                        ]}
                        onPress={() => void pausePlayback()}
                      >
                        <Text style={styles.transportIcon}>PAUSE</Text>
                        <Text
                          style={
                            transportState === "pause"
                              ? styles.transportButtonLabelPrimary
                              : styles.transportButtonLabel
                          }
                        >
                          Pause
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.transportButton,
                          transportState === "stop" ? styles.transportButtonPrimary : styles.transportButtonMuted,
                        ]}
                        onPress={() => void stopPlayback()}
                      >
                        <Text style={styles.transportIcon}>STOP</Text>
                        <Text
                          style={
                            transportState === "stop"
                              ? styles.transportButtonLabelPrimary
                              : styles.transportButtonLabel
                          }
                        >
                          Stop
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                  <View style={styles.tempoPanel}>
                    <View style={styles.tempoHeader}>
                      <Text style={styles.transportTitle}>Tempo Control</Text>
                      <Text style={styles.tempoValue}>{playbackTempo} BPM</Text>
                    </View>
                    <View style={styles.tempoBarTrack}>
                      <View
                        style={[
                          styles.tempoBarFill,
                          {
                            width: `${Math.max(
                              8,
                              Math.min(
                                100,
                                ((Math.max(40, Math.min(180, Number.parseInt(playbackTempo, 10) || 92)) - 40) / 140) * 100,
                              ),
                            )}%`,
                          },
                        ]}
                      />
                    </View>
                    <View style={styles.tempoControlsRow}>
                      <Pressable style={styles.tempoNudgeButton} onPress={() => nudgePlaybackTempo(-10)}>
                        <Text style={styles.tempoNudgeLabel}>-10</Text>
                      </Pressable>
                      <Pressable style={styles.tempoNudgeButton} onPress={() => nudgePlaybackTempo(-5)}>
                        <Text style={styles.tempoNudgeLabel}>-5</Text>
                      </Pressable>
                      <TextInput
                        keyboardType="numeric"
                        value={playbackTempo}
                        onChangeText={setPlaybackTempo}
                        style={styles.tempoInput}
                        placeholder="92"
                        placeholderTextColor="#6F87A5"
                      />
                      <Pressable style={styles.tempoNudgeButton} onPress={() => nudgePlaybackTempo(5)}>
                        <Text style={styles.tempoNudgeLabel}>+5</Text>
                      </Pressable>
                      <Pressable style={styles.tempoNudgeButton} onPress={() => nudgePlaybackTempo(10)}>
                        <Text style={styles.tempoNudgeLabel}>+10</Text>
                      </Pressable>
                    </View>
                  </View>
                  <View style={styles.exportPanel}>
                    <Text style={styles.transportTitle}>Export Stored Audio / Score</Text>
                    <View style={styles.exportRow}>
                      {(["audio", "musicxml", "midi"] as const).map((exportFormat) => (
                        <Pressable
                          key={`${activePlaybackScore.id}-${exportFormat}`}
                          style={styles.exportButton}
                          onPress={() => {
                            const activeVoice = selectedPlaybackVoice;
                            if (activeVoice) {
                              void exportVoice(activePlaybackScore.id, activeVoice, exportFormat);
                            } else {
                              setApiError("Select a voice first before exporting.");
                            }
                          }}
                        >
                          <Text style={styles.exportButtonLabel}>{exportFormat.toUpperCase()}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {activeTab === "Practice" ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Practice Studio</Text>
            <Text style={styles.sectionTitle}>Record your voice and compare it</Text>
            <View style={styles.controlsCard}>
              <Text style={styles.listCardText}>
                Choose a parsed score and voice part, record your take, then let Singmobi compare it with the generated reference.
              </Text>
            </View>
            <View style={styles.stack}>
              {parsedScores.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.listCardText}>
                    No parsed scores available yet. Parse a score in Library before starting practice.
                  </Text>
                </View>
              ) : (
                parsedScores.map((score) => (
                  <View key={`practice-${score.id}`} style={styles.listCard}>
                    <View style={styles.listCardCopy}>
                      <Text style={styles.listCardTitle}>{score.title}</Text>
                      <Text style={styles.listCardText}>{score.composer}</Text>
                      <View style={styles.voiceButtonRow}>
                        {score.analysis?.voices
                          .filter((voice) => voice.detected_notes > 0)
                          .map((voice) => {
                            const activeVoice =
                              practiceScoreId === score.id && practiceVoice === voice.voice_part;
                            return (
                              <Pressable
                                key={`${score.id}-practice-${voice.voice_part}`}
                                style={[
                                  styles.voiceSelectButton,
                                  activeVoice ? styles.voiceSelectButtonActive : styles.voiceSelectButtonInactive,
                                ]}
                                onPress={() => {
                                  setPracticeScoreId(score.id);
                                  setPracticeVoice(voice.voice_part);
                                  setPracticeResult(null);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.voiceSelectButtonLabel,
                                    activeVoice ? styles.voiceSelectButtonLabelActive : null,
                                  ]}
                                >
                                  {voice.voice_part}
                                </Text>
                              </Pressable>
                            );
                          })}
                      </View>
                      <Text style={styles.listCardText}>
                        {practiceScoreId === score.id
                          ? `Selected for practice analysis: ${practiceVoice ?? "Choose a voice"}`
                          : "Pick a voice above to practice against its generated reference."}
                      </Text>
                    </View>
                  </View>
                ))
              )}
              <View style={styles.playbackCard}>
                <View style={styles.playbackHeader}>
                  <View>
                    <Text style={styles.analysisMeta}>Practice Recorder</Text>
                    <Text style={styles.playbackTitle}>{activePracticeScore?.title ?? "Choose a score"}</Text>
                    <Text style={styles.analysisMeta}>
                      {practiceVoice ? `${practiceVoice} selected for comparison` : "Select a parsed voice part to begin"}
                    </Text>
                  </View>
                </View>
                <View style={styles.transportPanel}>
                  <View style={styles.transportHeader}>
                    <Text style={styles.transportTitle}>Record Practice</Text>
                    <Text style={styles.transportSubtitle}>
                      {isPracticeRecording
                        ? "Recording in progress..."
                        : isPracticePlaying
                        ? "Playing your selected take in the background"
                        : practiceRecordingUri
                        ? `Recorded ${formatDuration(practiceRecordingDurationMs)}`
                        : "No recording yet"}
                    </Text>
                  </View>
                  <View style={styles.transportRow}>
                    <Pressable
                      style={[
                        styles.transportButton,
                        isPracticeRecording ? styles.transportButtonPrimary : styles.transportButtonMuted,
                      ]}
                      onPress={() => void startPracticeRecording()}
                    >
                      <Text style={styles.transportIcon}>REC</Text>
                      <Text
                        style={isPracticeRecording ? styles.transportButtonLabelPrimary : styles.transportButtonLabel}
                      >
                        Record
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.transportButton, styles.transportButtonMuted]}
                      onPress={() => void stopPracticeRecording()}
                    >
                      <Text style={styles.transportIcon}>STOP</Text>
                      <Text style={styles.transportButtonLabel}>Stop</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.transportButton, styles.transportButtonMuted]}
                      onPress={() => void playPracticeRecording()}
                    >
                      <Text style={styles.transportIcon}>PLAY</Text>
                      <Text style={styles.transportButtonLabel}>Replay</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={styles.exportPanel}>
                  <Text style={styles.transportTitle}>Analyze Recording</Text>
                  <Pressable
                    style={[styles.primaryButton, isPracticeSubmitting ? styles.disabledButton : null]}
                    onPress={() => void submitPracticeRecording()}
                    disabled={isPracticeSubmitting}
                  >
                    {isPracticeSubmitting ? (
                      <View style={styles.buttonBusyRow}>
                        <ActivityIndicator size="small" color="#07111F" />
                        <Text style={styles.primaryButtonLabelDark}>Analyzing...</Text>
                      </View>
                    ) : (
                      <Text style={styles.primaryButtonLabelDark}>Analyze My Voice</Text>
                    )}
                  </Pressable>
                  {practiceResult ? (
                    <View style={styles.analysisChip}>
                      <Text style={styles.analysisChipTitle}>Accuracy {practiceResult.accuracy_percent}%</Text>
                      <Text style={styles.analysisChipText}>{practiceResult.feedback}</Text>
                      <Text style={styles.analysisChipText}>
                        Recording {formatDuration(practiceResult.duration_ms)} | Reference {formatDuration(practiceResult.reference_duration_ms)}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.exportPanel}>
                  <Text style={styles.transportTitle}>Recorded Voices</Text>
                  {practiceRecordings.length === 0 ? (
                    <Text style={styles.listCardText}>
                      Your saved practice takes will appear here after analysis.
                    </Text>
                  ) : (
                    <View style={styles.stack}>
                      {practiceRecordings.map((recording) => {
                        const isActiveTake = activePracticePlaybackId === recording.id;
                        return (
                          <View key={recording.id} style={styles.practiceRecordingCard}>
                            <View style={styles.practiceRecordingCopy}>
                              <Text style={styles.practiceRecordingTitle}>{recording.score_title}</Text>
                              <Text style={styles.practiceRecordingMeta}>
                                {recording.voice_part} | Accuracy {recording.accuracy_percent}% | {formatDuration(recording.duration_ms)}
                              </Text>
                            </View>
                            <View style={styles.practiceRecordingActions}>
                              <Pressable
                                style={[
                                  styles.voiceSelectButton,
                                  isActiveTake && isPracticePlaying
                                    ? styles.voiceSelectButtonActive
                                    : styles.voiceSelectButtonInactive,
                                ]}
                                onPress={() => void playSavedPracticeRecording(recording)}
                              >
                                <Text
                                  style={[
                                    styles.voiceSelectButtonLabel,
                                    isActiveTake && isPracticePlaying ? styles.voiceSelectButtonLabelActive : null,
                                  ]}
                                >
                                  Play
                                </Text>
                              </Pressable>
                              <Pressable
                                style={[
                                  styles.voiceSelectButton,
                                  isActiveTake && !isPracticePlaying
                                    ? styles.voiceSelectButtonActive
                                    : styles.voiceSelectButtonInactive,
                                ]}
                                onPress={() => void pausePracticePlayback()}
                              >
                                <Text
                                  style={[
                                    styles.voiceSelectButtonLabel,
                                    isActiveTake && !isPracticePlaying && practiceSound
                                      ? styles.voiceSelectButtonLabelActive
                                      : null,
                                  ]}
                                >
                                  Pause
                                </Text>
                              </Pressable>
                              <Pressable
                                style={[styles.voiceSelectButton, styles.voiceSelectButtonInactive]}
                                onPress={() => confirmDeletePracticeRecording(recording)}
                              >
                                <Text style={styles.voiceSelectButtonLabel}>Delete</Text>
                              </Pressable>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              </View>
            </View>
          </View>
        ) : null}

        {activeTab === "Account" ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Singer Account</Text>
            <Text style={styles.sectionTitle}>Manage your practice profile</Text>
            <View style={styles.controlsCard}>
              <SummaryCard
                label="Signed In As"
                value={currentUser?.full_name || "Singer"}
                note={currentUser?.email || signInEmail || signUpEmail || "Account email pending"}
              />
              <SummaryCard label="Assigned Part" value={selectedPart} note={selectedVoice.range} />
              <SummaryCard
                label="Saved Scores"
                value={`${scores.length}`}
                note="stored with your account even after you sign out"
              />
              <SummaryCard
                label="Data Storage"
                value={
                  storageStatus?.backend === "mongodb" && storageStatus?.migration_completed
                    ? "MongoDB Active"
                    : "Storage Loading"
                }
                note={
                  storageStatus
                    ? `${storageStatus.counts.scores} scores, ${storageStatus.counts.practice_recordings} practice takes, ${storageStatus.counts.users} users`
                    : "Checking connected database"
                }
              />
              {storageStatus?.migration_completed ? (
                <View style={styles.statusPanel}>
                  <Text style={styles.analysisMeta}>
                    Account data is now loaded from MongoDB database `{storageStatus.database_name}`.
                  </Text>
                  {storageStatus.legacy_json_files_remaining.length ? (
                    <Text style={styles.warningText}>
                      Legacy JSON files still present: {storageStatus.legacy_json_files_remaining.length}
                    </Text>
                  ) : (
                    <Text style={styles.analysisMeta}>
                      Legacy JSON files archived successfully after migration.
                    </Text>
                  )}
                </View>
              ) : null}
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  void SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
                  setAuthToken("");
                  setCurrentUser(null);
                  setIsAuthenticated(false);
                  setScores([]);
                  setPracticeRecordings([]);
                  setApiError("");
                  setSuccessMessage("");
                }}
              >
                <Text style={styles.secondaryButtonLabel}>Sign Out</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {activePlaybackScore && selectedPlaybackVoice && sound ? (
          <View style={styles.bottomDock}>
            <View style={styles.bottomDockCopy}>
              <Text style={styles.bottomDockLabel}>Now Playing</Text>
              <Text style={styles.bottomDockValue}>
                {activePlaybackScore.title} | {selectedPlaybackVoice}
              </Text>
            </View>
            <View style={styles.bottomDockTransport}>
              <Pressable
                style={[
                  styles.bottomDockButton,
                  transportState === "play" ? styles.bottomDockButtonPrimary : styles.bottomDockButtonMuted,
                ]}
                onPress={() => void resumePlayback()}
              >
                <Text
                  style={
                    transportState === "play"
                      ? styles.bottomDockButtonTextPrimary
                      : styles.bottomDockButtonText
                  }
                >
                  Play
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.bottomDockButton,
                  transportState === "pause" ? styles.bottomDockButtonPrimary : styles.bottomDockButtonMuted,
                ]}
                onPress={() => void pausePlayback()}
              >
                <Text
                  style={
                    transportState === "pause"
                      ? styles.bottomDockButtonTextPrimary
                      : styles.bottomDockButtonText
                  }
                >
                  Pause
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.bottomDockButton,
                  transportState === "stop" ? styles.bottomDockButtonPrimary : styles.bottomDockButtonMuted,
                ]}
                onPress={() => void stopPlayback()}
              >
                <Text
                  style={
                    transportState === "stop"
                      ? styles.bottomDockButtonTextPrimary
                      : styles.bottomDockButtonText
                  }
                >
                  Stop
                </Text>
              </Pressable>
            </View>
          </View>
        ) : practiceSound && activePracticeRecording ? (
          <View style={styles.bottomDock}>
            <View style={styles.bottomDockCopy}>
              <Text style={styles.bottomDockLabel}>Practice Take</Text>
              <Text style={styles.bottomDockValue}>
                {activePracticeRecording.score_title} | {activePracticeRecording.voice_part}
              </Text>
            </View>
            <View style={styles.bottomDockTransport}>
              <Pressable
                style={[
                  styles.bottomDockButton,
                  isPracticePlaying ? styles.bottomDockButtonPrimary : styles.bottomDockButtonMuted,
                ]}
                onPress={() =>
                  void (
                    practiceSound
                      ? practiceSound.playAsync().then(() => setIsPracticePlaying(true))
                      : Promise.resolve()
                  )
                }
              >
                <Text
                  style={
                    isPracticePlaying
                      ? styles.bottomDockButtonTextPrimary
                      : styles.bottomDockButtonText
                  }
                >
                  Play
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.bottomDockButton,
                  !isPracticePlaying ? styles.bottomDockButtonPrimary : styles.bottomDockButtonMuted,
                ]}
                onPress={() => void pausePracticePlayback()}
              >
                <Text
                  style={
                    !isPracticePlaying
                      ? styles.bottomDockButtonTextPrimary
                      : styles.bottomDockButtonText
                  }
                >
                  Pause
                </Text>
              </Pressable>
              <Pressable
                style={[styles.bottomDockButton, styles.bottomDockButtonMuted]}
                onPress={() => void stopPracticePlayback()}
              >
                <Text style={styles.bottomDockButtonText}>Stop</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AuthInput({
  label,
  value,
  onChangeText,
  secureTextEntry,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  secureTextEntry?: boolean;
}) {
  return (
    <View style={styles.inputBlock}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        style={styles.input}
        placeholder={label}
        placeholderTextColor="#6F87A5"
        autoCapitalize="none"
      />
    </View>
  );
}

function SummaryCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryNote}>{note}</Text>
    </View>
  );
}

function MusicHeroArt() {
  return (
    <View style={styles.heroArtWrap}>
      <View style={styles.heroScoreCard}>
        <View style={styles.heroScoreHeader}>
          <Text style={styles.heroScoreBrand}>Singmobi</Text>
          <Text style={styles.heroScoreMark}>♪</Text>
        </View>
        <View style={styles.heroStaffWrap}>
          {[0, 1, 2, 3, 4].map((line) => (
            <View key={`staff-${line}`} style={styles.heroStaffLine} />
          ))}
          <View style={styles.heroNoteCluster}>
            <View style={styles.heroNoteStem} />
            <View style={styles.heroNoteHeadLarge} />
            <View style={styles.heroNoteHeadSmall} />
          </View>
        </View>
      </View>
    </View>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatStatus(status: string) {
  switch (status) {
    case "uploaded":
      return "Stored";
    case "queued":
      return "Queued";
    case "parsing":
      return "Parsing";
    case "parsed":
      return "Parsed";
    case "needs_conversion":
      return "Needs Conversion";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function sanitizeFileNameSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9-_]+/g, "_").replace(/^_+|_+$/g, "") || "score";
}

function getFriendlyMessage(message: string) {
  const lowered = message.toLowerCase();
  if (lowered.includes("network request failed") || lowered.includes("timed out")) {
    return "The app is having trouble reaching the server right now. Check the backend connection and try again.";
  }
  if (lowered.includes("microphone")) {
    return "Microphone access is needed before practice recording can start.";
  }
  if (lowered.includes("password")) {
    return message;
  }
  return "Something needs attention. Please try again, and if it continues, restart the app and backend.";
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#07111F",
  },
  keyboardWrap: {
    flex: 1,
  },
  container: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 36,
    gap: 18,
  },
  formCard: {
    borderRadius: 28,
    backgroundColor: "#0F1B2D",
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: "#1C2D46",
    shadowColor: "#02060D",
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  authToggleRow: {
    flexDirection: "row",
    gap: 10,
  },
  authToggle: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: "#132238",
    paddingVertical: 12,
    alignItems: "center",
  },
  authToggleActive: {
    backgroundColor: "#F2B84B",
  },
  authToggleLabel: {
    color: "#8EA5C2",
    fontSize: 14,
    fontWeight: "700",
  },
  authToggleLabelActive: {
    color: "#07111F",
  },
  heroCard: {
    borderRadius: 30,
    backgroundColor: "#111E31",
    padding: 22,
    shadowColor: "#02060D",
    shadowOpacity: 0.36,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
    overflow: "hidden",
  },
  heroOverlayOne: {
    position: "absolute",
    right: -20,
    top: -14,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(242,184,75,0.18)",
  },
  heroOverlayTwo: {
    position: "absolute",
    left: -18,
    bottom: -20,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(72,124,229,0.18)",
  },
  heroArtWrap: {
    alignItems: "flex-end",
    marginBottom: 8,
  },
  heroScoreCard: {
    width: 168,
    borderRadius: 24,
    backgroundColor: "rgba(9, 20, 36, 0.88)",
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    transform: [{ rotate: "-5deg" }],
  },
  heroScoreHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  heroScoreBrand: {
    color: "#F7F3EA",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  heroScoreMark: {
    color: "#F2B84B",
    fontSize: 24,
    fontWeight: "800",
  },
  heroStaffWrap: {
    gap: 8,
    position: "relative",
    paddingVertical: 6,
  },
  heroStaffLine: {
    height: 2,
    borderRadius: 999,
    backgroundColor: "rgba(227, 237, 251, 0.25)",
  },
  heroNoteCluster: {
    position: "absolute",
    right: 22,
    top: 6,
    width: 52,
    height: 54,
  },
  heroNoteStem: {
    position: "absolute",
    right: 8,
    top: 0,
    width: 4,
    height: 36,
    borderRadius: 999,
    backgroundColor: "#F2B84B",
  },
  heroNoteHeadLarge: {
    position: "absolute",
    right: 0,
    bottom: 8,
    width: 18,
    height: 14,
    borderRadius: 999,
    backgroundColor: "#F2B84B",
    transform: [{ rotate: "-18deg" }],
  },
  heroNoteHeadSmall: {
    position: "absolute",
    left: 8,
    bottom: 18,
    width: 16,
    height: 12,
    borderRadius: 999,
    backgroundColor: "#4D8CFF",
    transform: [{ rotate: "-18deg" }],
  },
  eyebrow: {
    color: "#F2B84B",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  eyebrowDark: {
    color: "#F6CD79",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  heroTitle: {
    marginTop: 10,
    color: "#F7F3EA",
    fontSize: 34,
    fontWeight: "800",
    lineHeight: 38,
  },
  heroText: {
    marginTop: 14,
    color: "#AFC0D8",
    fontSize: 15,
    lineHeight: 24,
  },
  heroTitleDark: {
    marginTop: 10,
    color: "#F7F3EA",
    fontSize: 34,
    fontWeight: "800",
    lineHeight: 38,
  },
  heroTextDark: {
    marginTop: 14,
    color: "#C8D6E8",
    fontSize: 15,
    lineHeight: 24,
  },
  heroStatsRow: {
    marginTop: 18,
    flexDirection: "row",
    gap: 10,
  },
  heroStatCard: {
    flex: 1,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 12,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  heroStatLabel: {
    color: "#8EA5C2",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  heroStatValue: {
    marginTop: 8,
    color: "#F7F3EA",
    fontSize: 21,
    fontWeight: "800",
  },
  statusRow: {
    marginTop: 18,
    gap: 10,
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#13233B",
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  badgeSoft: {
    backgroundColor: "#1A2740",
  },
  badgeAi: {
    backgroundColor: "#1C2648",
  },
  badgeLabel: {
    color: "#F2B84B",
    fontSize: 13,
    fontWeight: "700",
  },
  badgeLabelSoft: {
    color: "#9FB2CA",
    fontSize: 13,
    fontWeight: "700",
  },
  errorCard: {
    borderRadius: 24,
    backgroundColor: "#2A1720",
    padding: 18,
    borderWidth: 1,
    borderColor: "#6D3143",
  },
  errorTitle: {
    color: "#FFB2A8",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 6,
  },
  errorText: {
    color: "#F3D3CC",
    fontSize: 14,
    lineHeight: 22,
  },
  successCard: {
    borderRadius: 24,
    backgroundColor: "#163125",
    padding: 18,
    borderWidth: 1,
    borderColor: "#2F6B4E",
  },
  successTitle: {
    color: "#B8F1CF",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 6,
  },
  successText: {
    color: "#D9F7E7",
    fontSize: 14,
    lineHeight: 22,
  },
  section: {
    gap: 12,
  },
  tabsRow: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#0D1728",
    borderRadius: 22,
    padding: 8,
    borderWidth: 1,
    borderColor: "#1C2D46",
  },
  tabButton: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 12,
    alignItems: "center",
  },
  tabButtonActive: {
    backgroundColor: "#F2B84B",
    shadowColor: "#F2B84B",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  tabButtonLabel: {
    color: "#93A8C4",
    fontSize: 13,
    fontWeight: "800",
  },
  tabButtonLabelActive: {
    color: "#07111F",
  },
  sectionLabel: {
    color: "#F2B84B",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  sectionTitle: {
    color: "#F7F3EA",
    fontSize: 28,
    fontWeight: "800",
  },
  summaryGrid: {
    gap: 12,
  },
  summaryCard: {
    borderRadius: 24,
    backgroundColor: "#0F1B2D",
    padding: 18,
    borderWidth: 1,
    borderColor: "#1C2D46",
  },
  summaryLabel: {
    color: "#8EA5C2",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  summaryValue: {
    marginTop: 10,
    color: "#F7F3EA",
    fontSize: 30,
    fontWeight: "800",
  },
  summaryNote: {
    marginTop: 6,
    color: "#9FB2CA",
    fontSize: 14,
  },
  stack: {
    gap: 12,
  },
  listCard: {
    borderRadius: 24,
    backgroundColor: "#0F1B2D",
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: "#1C2D46",
    overflow: "hidden",
  },
  emptyCard: {
    borderRadius: 24,
    backgroundColor: "#0F1B2D",
    padding: 18,
    borderWidth: 1,
    borderColor: "#1C2D46",
  },
  listAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 6,
  },
  listCardCopy: {
    gap: 8,
  },
  listCardTitle: {
    color: "#F7F3EA",
    fontSize: 18,
    fontWeight: "800",
  },
  listCardText: {
    color: "#9FB2CA",
    fontSize: 14,
    lineHeight: 22,
  },
  scoreActions: {
    flexDirection: "row",
    gap: 10,
  },
  ghostButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#162743",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#294066",
  },
  disabledButton: {
    opacity: 0.6,
  },
  ghostButtonLabel: {
    color: "#D6E4F6",
    fontSize: 13,
    fontWeight: "700",
  },
  voiceGrid: {
    gap: 12,
  },
  voiceButtonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  voiceCard: {
    borderRadius: 24,
    padding: 18,
    borderWidth: 2,
    minHeight: 148,
  },
  voiceBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 12,
  },
  voiceBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  voiceLabel: {
    fontSize: 20,
    fontWeight: "800",
  },
  voiceRange: {
    marginTop: 8,
    color: "#D6E4F6",
    fontSize: 14,
    fontWeight: "600",
  },
  voiceHint: {
    marginTop: 12,
    color: "#C2D2E6",
    fontSize: 14,
    lineHeight: 21,
  },
  controlsCard: {
    borderRadius: 24,
    backgroundColor: "#0F1B2D",
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: "#1C2D46",
  },
  statusPanel: {
    marginTop: 4,
    gap: 8,
    borderRadius: 18,
    backgroundColor: "#132238",
    padding: 12,
    borderWidth: 1,
    borderColor: "#233655",
  },
  statusRowInline: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusChip: {
    borderRadius: 999,
    backgroundColor: "#193150",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusChipLabel: {
    color: "#F2B84B",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  statusPercentLabel: {
    color: "#C9D7E8",
    fontSize: 12,
    fontWeight: "800",
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: "#22314B",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#F2B84B",
  },
  analysisBlock: {
    marginTop: 4,
    gap: 10,
  },
  playbackCard: {
    marginTop: 4,
    gap: 12,
    borderRadius: 18,
    backgroundColor: "#132238",
    padding: 14,
    borderWidth: 1,
    borderColor: "#233655",
  },
  playbackHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  playbackTitle: {
    marginTop: 4,
    color: "#F7F3EA",
    fontSize: 20,
    fontWeight: "800",
  },
  playbackPill: {
    borderRadius: 999,
    backgroundColor: "#1A3154",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#2C4874",
  },
  playbackPillLabel: {
    color: "#F2B84B",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  analysisMeta: {
    color: "#93A8C4",
    fontSize: 12,
    fontWeight: "700",
  },
  analysisChips: {
    gap: 10,
  },
  analysisChip: {
    borderRadius: 18,
    backgroundColor: "#132238",
    padding: 12,
    borderWidth: 1,
    borderColor: "#233655",
  },
  analysisChipTitle: {
    color: "#F7F3EA",
    fontSize: 13,
    fontWeight: "800",
  },
  analysisChipText: {
    color: "#B0C2D9",
    fontSize: 12,
    lineHeight: 18,
  },
  warningStack: {
    gap: 6,
  },
  warningText: {
    color: "#F5C27F",
    fontSize: 12,
    lineHeight: 18,
  },
  voiceSelectButton: {
    borderRadius: 999,
    backgroundColor: "#162743",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#294066",
  },
  voiceSelectButtonInactive: {
    backgroundColor: "#101C30",
    borderColor: "#22314B",
    opacity: 0.72,
  },
  voiceSelectButtonActive: {
    backgroundColor: "#F2B84B",
    borderColor: "#F2B84B",
    opacity: 1,
  },
  voiceSelectButtonPlaying: {
    borderColor: "#F2B84B",
    shadowColor: "#F2B84B",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  voiceSelectButtonLabel: {
    color: "#D6E4F6",
    fontSize: 13,
    fontWeight: "700",
  },
  voiceSelectButtonMeta: {
    color: "#89A3C5",
    fontSize: 11,
    fontWeight: "700",
  },
  voiceSelectButtonLabelActive: {
    color: "#07111F",
  },
  voiceSelectButtonMetaActive: {
    color: "#4C3A10",
  },
  playbackProgressPanel: {
    gap: 12,
    borderRadius: 18,
    backgroundColor: "#101C30",
    padding: 14,
    borderWidth: 1,
    borderColor: "#20314A",
  },
  playbackProgressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  playbackTimelineTrack: {
    height: 12,
    borderRadius: 999,
    backgroundColor: "#22314B",
    overflow: "hidden",
  },
  playbackTimelineFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#F2B84B",
  },
  timelineNudgeRow: {
    flexDirection: "row",
    gap: 8,
  },
  timelineNudgeButton: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: "#162743",
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#294066",
  },
  timelineNudgeLabel: {
    color: "#D6E4F6",
    fontSize: 12,
    fontWeight: "800",
  },
  transportPanel: {
    gap: 12,
    borderRadius: 18,
    backgroundColor: "#101C30",
    padding: 14,
    borderWidth: 1,
    borderColor: "#20314A",
  },
  transportHeader: {
    gap: 4,
  },
  transportTitle: {
    color: "#F7F3EA",
    fontSize: 15,
    fontWeight: "800",
  },
  transportSubtitle: {
    color: "#93A8C4",
    fontSize: 12,
  },
  transportRow: {
    flexDirection: "row",
    gap: 10,
  },
  transportButton: {
    flex: 1,
    borderRadius: 20,
    backgroundColor: "#162743",
    minHeight: 70,
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#294066",
  },
  transportButtonMuted: {
    backgroundColor: "#162743",
    borderColor: "#294066",
  },
  transportButtonPrimary: {
    backgroundColor: "#F2B84B",
    borderColor: "#F2B84B",
  },
  transportIcon: {
    color: "#F7F3EA",
    fontSize: 18,
    fontWeight: "800",
  },
  transportButtonLabel: {
    color: "#D6E4F6",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  transportButtonLabelPrimary: {
    color: "#07111F",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  tempoPanel: {
    gap: 12,
    borderRadius: 18,
    backgroundColor: "#101C30",
    padding: 14,
    borderWidth: 1,
    borderColor: "#20314A",
  },
  tempoHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tempoValue: {
    color: "#F2B84B",
    fontSize: 15,
    fontWeight: "800",
  },
  tempoBarTrack: {
    height: 12,
    borderRadius: 999,
    backgroundColor: "#22314B",
    overflow: "hidden",
  },
  tempoBarFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#4D8CFF",
  },
  tempoControlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  tempoNudgeButton: {
    borderRadius: 14,
    backgroundColor: "#162743",
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#294066",
  },
  tempoNudgeLabel: {
    color: "#D6E4F6",
    fontSize: 12,
    fontWeight: "800",
  },
  tempoInput: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#294066",
    backgroundColor: "#132238",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#F7F3EA",
    fontSize: 15,
    textAlign: "center",
    fontWeight: "800",
  },
  exportPanel: {
    gap: 10,
    borderRadius: 18,
    backgroundColor: "#101C30",
    padding: 14,
    borderWidth: 1,
    borderColor: "#20314A",
  },
  exportRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  exportButton: {
    borderRadius: 14,
    backgroundColor: "#162743",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#294066",
  },
  exportButtonLabel: {
    color: "#D6E4F6",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  playbackStatusText: {
    color: "#D6E4F6",
    fontSize: 13,
    lineHeight: 20,
  },
  bottomDock: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: 20,
    backgroundColor: "#0A1424",
    padding: 14,
    borderWidth: 1,
    borderColor: "#20314A",
  },
  bottomDockCopy: {
    flex: 1,
    gap: 4,
  },
  bottomDockLabel: {
    color: "#89A3C5",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  bottomDockValue: {
    color: "#F7F3EA",
    fontSize: 16,
    fontWeight: "800",
  },
  bottomDockTransport: {
    flexDirection: "row",
    gap: 8,
  },
  bottomDockButton: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minWidth: 58,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomDockButtonMuted: {
    backgroundColor: "#162743",
    borderWidth: 1,
    borderColor: "#294066",
  },
  bottomDockButtonPrimary: {
    backgroundColor: "#F2B84B",
  },
  bottomDockButtonText: {
    color: "#D6E4F6",
    fontSize: 12,
    fontWeight: "800",
  },
  bottomDockButtonTextPrimary: {
    color: "#07111F",
    fontSize: 12,
    fontWeight: "800",
  },
  inputBlock: {
    gap: 8,
  },
  inputLabel: {
    color: "#D6E4F6",
    fontSize: 14,
    fontWeight: "700",
  },
  input: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#233655",
    backgroundColor: "#132238",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#F7F3EA",
    fontSize: 15,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: {
    flex: 1,
  },
  searchButton: {
    borderRadius: 18,
    backgroundColor: "#162743",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#294066",
  },
  searchButtonLabel: {
    color: "#D6E4F6",
    fontSize: 13,
    fontWeight: "800",
  },
  primaryButton: {
    marginTop: 6,
    borderRadius: 999,
    backgroundColor: "#F2B84B",
    paddingVertical: 14,
    alignItems: "center",
    shadowColor: "#F2B84B",
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
  },
  primaryButtonLabel: {
    color: "#07111F",
    fontSize: 15,
    fontWeight: "800",
  },
  primaryButtonLabelDark: {
    color: "#07111F",
    fontSize: 15,
    fontWeight: "800",
  },
  buttonBusyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  secondaryButton: {
    marginTop: 6,
    borderRadius: 999,
    backgroundColor: "#132238",
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#233655",
  },
  secondaryButtonLabel: {
    color: "#D6E4F6",
    fontSize: 15,
    fontWeight: "800",
  },
  practiceRecordingCard: {
    borderRadius: 18,
    backgroundColor: "#132238",
    padding: 14,
    borderWidth: 1,
    borderColor: "#233655",
    gap: 12,
  },
  practiceRecordingCopy: {
    flex: 1,
    gap: 6,
  },
  practiceRecordingTitle: {
    color: "#F7F3EA",
    fontSize: 14,
    fontWeight: "800",
  },
  practiceRecordingMeta: {
    color: "#9FB2CA",
    fontSize: 12,
    lineHeight: 18,
  },
  practiceRecordingActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  inlineError: {
    borderRadius: 18,
    backgroundColor: "#2A1720",
    padding: 14,
    borderWidth: 1,
    borderColor: "#6D3143",
  },
});
