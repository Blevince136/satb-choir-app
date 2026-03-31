import { StatusBar } from "expo-status-bar";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useEffect, useMemo, useState } from "react";
import {
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

type VoicePart = {
  name: "Soprano" | "Alto" | "Tenor" | "Bass";
  range: string;
  accent: string;
  tone: string;
};

const API_BASE_URL = "http://10.0.2.2:8000";
const allowedMimeTypes = [
  "application/pdf",
  "application/vnd.recordare.musicxml+xml",
  "application/xml",
  "text/xml",
  "audio/midi",
  "audio/x-midi",
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

const tabs = ["Home", "Scores", "Account"] as const;
const authModes = ["signIn", "signUp"] as const;

type TabKey = (typeof tabs)[number];
type AuthMode = (typeof authModes)[number];

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("signIn");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("Home");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [apiError, setApiError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [selectedPart, setSelectedPart] = useState<VoicePart["name"]>("Alto");
  const [tempo, setTempo] = useState("92");
  const [progress, setProgress] = useState("78");
  const [scores, setScores] = useState<Score[]>([]);
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signUpName, setSignUpName] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");

  useEffect(() => {
    let active = true;

    async function fetchHealthAndScores() {
      try {
        const [healthResponse, scoresResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/api/health`),
          fetch(`${API_BASE_URL}/api/scores`),
        ]);

        if (!healthResponse.ok) {
          throw new Error(`Status ${healthResponse.status}`);
        }

        const healthData = (await healthResponse.json()) as HealthResponse;
        const scoreData = scoresResponse.ok ? ((await scoresResponse.json()) as Score[]) : [];
        if (active) {
          setHealth(healthData);
          setScores(scoreData);
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

    void fetchHealthAndScores();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const interval = setInterval(() => {
      void refreshScores();
    }, 3000);

    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const selectedVoice = useMemo(
    () => voiceParts.find((part) => part.name === selectedPart) ?? voiceParts[0],
    [selectedPart],
  );

  async function refreshScores() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/scores`);
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

  function submitAuth() {
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
    setIsAuthenticated(true);
    setActiveTab("Home");
  }

  async function importScore() {
    try {
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
      const uploadResult = await FileSystem.uploadAsync(`${API_BASE_URL}/api/scores`, asset.uri, {
        fieldName: "file",
        httpMethod: "POST",
        mimeType: asset.mimeType ?? "application/octet-stream",
        parameters: {
          title: asset.name.replace(/\.[^/.]+$/, ""),
          composer: "Singer mobile upload",
        },
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      });

      if (uploadResult.status !== 200) {
        throw new Error(uploadResult.body || `Upload failed with status ${uploadResult.status}`);
      }

      await refreshScores();
      setApiError("Score uploaded and stored. Tap Parse Score when you are ready.");
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

  async function parseScore(scoreId: string) {
    try {
      setApiError("");
      const response = await fetch(`${API_BASE_URL}/api/scores/${scoreId}/parse`, {
        method: "POST",
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Parse failed with status ${response.status}`);
      }

      await refreshScores();
    } catch (error) {
      setApiError(
        error instanceof Error ? error.message : "Unable to start score parsing.",
      );
    }
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.heroCard}>
            <Text style={styles.eyebrow}>Singer Access</Text>
            <Text style={styles.heroTitle}>Sign in to practice your assigned SATB line.</Text>
            <Text style={styles.heroText}>
              This final-year mobile app is singer-centered. Start by creating an account or
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
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.heroCard}>
          <View style={styles.heroOverlayOne} />
          <View style={styles.heroOverlayTwo} />
          <Text style={styles.eyebrowDark}>Singer Mobile App</Text>
          <Text style={styles.heroTitleDark}>Practice your choir part wherever you are.</Text>
          <Text style={styles.heroTextDark}>
            This mobile app is focused on singers. Use the tabs below for practice, imported
            scores, and account information instead of one long continuous page.
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
              <Text style={styles.badgeLabel}>
                {health ? `${health.status} | ${health.service}` : "Checking API"}
              </Text>
            </View>
            <View style={[styles.badge, styles.badgeSoft]}>
              <Text style={styles.badgeLabelSoft}>Selected part: {selectedPart}</Text>
            </View>
          </View>
        </View>

        {apiError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Backend connection note</Text>
            <Text style={styles.errorText}>{apiError}</Text>
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
                <SummaryCard label="Tempo" value={`${tempo}%`} note="trainer-guided pace" />
                <SummaryCard label="Voice Part" value={selectedPart} note={selectedVoice.range} />
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

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>SATB Practice</Text>
              <Text style={styles.sectionTitle}>Choose the line to rehearse</Text>
              <View style={styles.voiceGrid}>
                {voiceParts.map((part) => {
                  const isActive = part.name === selectedPart;
                  return (
                    <Pressable
                      key={part.name}
                      onPress={() => setSelectedPart(part.name)}
                      style={[
                        styles.voiceCard,
                        {
                          backgroundColor: part.tone,
                          borderColor: isActive ? part.accent : "transparent",
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.voiceBadge,
                          { backgroundColor: isActive ? part.accent : "rgba(255,255,255,0.6)" },
                        ]}
                      >
                        <Text style={[styles.voiceBadgeText, { color: isActive ? "#FFFFFF" : part.accent }]}>
                          {isActive ? "Selected" : "Tap to focus"}
                        </Text>
                      </View>
                      <Text style={[styles.voiceLabel, { color: part.accent }]}>{part.name}</Text>
                      <Text style={styles.voiceRange}>{part.range}</Text>
                      <Text style={styles.voiceHint}>
                        Solo practice, mute others, and slow sections for repetition.
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Quick Controls</Text>
              <Text style={styles.sectionTitle}>Session tuning</Text>
              <View style={styles.controlsCard}>
                <View style={styles.inputBlock}>
                  <Text style={styles.inputLabel}>Tempo Percentage</Text>
                  <TextInput
                    keyboardType="numeric"
                    value={tempo}
                    onChangeText={setTempo}
                    style={styles.input}
                    placeholder="92"
                    placeholderTextColor="#8C816B"
                  />
                </View>
                <View style={styles.inputBlock}>
                  <Text style={styles.inputLabel}>Progress Target</Text>
                  <TextInput
                    keyboardType="numeric"
                    value={progress}
                    onChangeText={setProgress}
                    style={styles.input}
                    placeholder="78"
                    placeholderTextColor="#8C816B"
                  />
                </View>
                <Pressable style={styles.primaryButton}>
                  <Text style={styles.primaryButtonLabel}>Start Practice Session</Text>
                </Pressable>
              </View>
            </View>
          </>
        ) : null}

        {activeTab === "Scores" ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Imported Scores</Text>
            <Text style={styles.sectionTitle}>Bring in PDF, MIDI, and MusicXML</Text>
            <View style={styles.controlsCard}>
              <Text style={styles.listCardText}>
                On mobile, this first uploads the score and stores it in the system. Parsing is a
                separate action you start after upload so you can see the processing state clearly.
              </Text>
              <Pressable style={styles.primaryButton} onPress={importScore} disabled={isBusy}>
                <Text style={styles.primaryButtonLabel}>
                  {isBusy ? "Importing..." : "Import Score File"}
                </Text>
              </Pressable>
            </View>
            <View style={styles.stack}>
              {scores.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.listCardText}>
                    No imported scores yet. Add a PDF, MIDI, or MusicXML file to see it here.
                  </Text>
                </View>
              ) : (
                scores.map((score) => (
                  <View key={score.id} style={styles.listCard}>
                    <View style={styles.listCardCopy}>
                      <Text style={styles.listCardTitle}>{score.title}</Text>
                      <Text style={styles.listCardText}>
                        {score.composer} | {score.format} | {score.file_name}
                      </Text>
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
                          <Text style={styles.analysisMeta}>
                            Parser: {score.analysis.parser_used} | Source: {score.analysis.source_format}
                          </Text>
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
                            <View style={styles.warningStack}>
                              {score.analysis.warnings.map((warning) => (
                                <Text key={`${score.id}-${warning}`} style={styles.warningText}>
                                  {warning}
                                </Text>
                              ))}
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.scoreActions}>
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
                    </View>
                  </View>
                ))
              )}
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
                value={authMode === "signUp" ? signUpName || "New Singer" : signInEmail || "Singer"}
                note={authMode === "signUp" ? signUpEmail || "Account email pending" : signInEmail}
              />
              <SummaryCard label="Assigned Part" value={selectedPart} note={selectedVoice.range} />
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  setIsAuthenticated(false);
                  setApiError("");
                }}
              >
                <Text style={styles.secondaryButtonLabel}>Sign Out</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
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
        placeholderTextColor="#8C816B"
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#EFE4D1",
  },
  container: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 36,
    gap: 18,
  },
  formCard: {
    borderRadius: 28,
    backgroundColor: "#FFF9F0",
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: "#E7D7C2",
    shadowColor: "#2F2211",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  authToggleRow: {
    flexDirection: "row",
    gap: 10,
  },
  authToggle: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: "#F0E6D7",
    paddingVertical: 12,
    alignItems: "center",
  },
  authToggleActive: {
    backgroundColor: "#0F6C5B",
  },
  authToggleLabel: {
    color: "#6D5B45",
    fontSize: 14,
    fontWeight: "700",
  },
  authToggleLabelActive: {
    color: "#FFFFFF",
  },
  heroCard: {
    borderRadius: 30,
    backgroundColor: "#17322D",
    padding: 22,
    shadowColor: "#2F2211",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
    overflow: "hidden",
  },
  heroOverlayOne: {
    position: "absolute",
    right: -20,
    top: -14,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(229,163,118,0.18)",
  },
  heroOverlayTwo: {
    position: "absolute",
    left: -18,
    bottom: -20,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(73,182,164,0.18)",
  },
  eyebrow: {
    color: "#C56638",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  eyebrowDark: {
    color: "#D8B395",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  heroTitle: {
    marginTop: 10,
    color: "#1E1A16",
    fontSize: 34,
    fontWeight: "800",
    lineHeight: 38,
  },
  heroText: {
    marginTop: 14,
    color: "#665D4C",
    fontSize: 15,
    lineHeight: 24,
  },
  heroTitleDark: {
    marginTop: 10,
    color: "#FFF8EE",
    fontSize: 34,
    fontWeight: "800",
    lineHeight: 38,
  },
  heroTextDark: {
    marginTop: 14,
    color: "rgba(255,248,238,0.78)",
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
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  heroStatLabel: {
    color: "rgba(255,248,238,0.7)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  heroStatValue: {
    marginTop: 8,
    color: "#FFF8EE",
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
    backgroundColor: "#E1F0EC",
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  badgeSoft: {
    backgroundColor: "#F3EBDE",
  },
  badgeLabel: {
    color: "#0F6C5B",
    fontSize: 13,
    fontWeight: "700",
  },
  badgeLabelSoft: {
    color: "#7E5D3D",
    fontSize: 13,
    fontWeight: "700",
  },
  errorCard: {
    borderRadius: 24,
    backgroundColor: "#FFF0E5",
    padding: 18,
    borderWidth: 1,
    borderColor: "#F1D0BA",
  },
  errorTitle: {
    color: "#A35528",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 6,
  },
  errorText: {
    color: "#8A4A25",
    fontSize: 14,
    lineHeight: 22,
  },
  section: {
    gap: 12,
  },
  tabsRow: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#E7DAC8",
    borderRadius: 22,
    padding: 8,
  },
  tabButton: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 12,
    alignItems: "center",
  },
  tabButtonActive: {
    backgroundColor: "#0F6C5B",
    shadowColor: "#0F6C5B",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  tabButtonLabel: {
    color: "#6D5B45",
    fontSize: 13,
    fontWeight: "800",
  },
  tabButtonLabelActive: {
    color: "#FFFFFF",
  },
  sectionLabel: {
    color: "#C56638",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  sectionTitle: {
    color: "#1E1A16",
    fontSize: 28,
    fontWeight: "800",
  },
  summaryGrid: {
    gap: 12,
  },
  summaryCard: {
    borderRadius: 24,
    backgroundColor: "#FFF9F0",
    padding: 18,
    borderWidth: 1,
    borderColor: "#E7D7C2",
  },
  summaryLabel: {
    color: "#7E5D3D",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  summaryValue: {
    marginTop: 10,
    color: "#1E1A16",
    fontSize: 30,
    fontWeight: "800",
  },
  summaryNote: {
    marginTop: 6,
    color: "#665D4C",
    fontSize: 14,
  },
  stack: {
    gap: 12,
  },
  listCard: {
    borderRadius: 24,
    backgroundColor: "#FFF9F0",
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: "#E7D7C2",
    overflow: "hidden",
  },
  emptyCard: {
    borderRadius: 24,
    backgroundColor: "#FFF9F0",
    padding: 18,
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
    color: "#1E1A16",
    fontSize: 18,
    fontWeight: "800",
  },
  listCardText: {
    color: "#665D4C",
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
    backgroundColor: "#E4F2EE",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  disabledButton: {
    opacity: 0.6,
  },
  ghostButtonLabel: {
    color: "#0F6C5B",
    fontSize: 13,
    fontWeight: "700",
  },
  voiceGrid: {
    gap: 12,
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
    color: "#473B2F",
    fontSize: 14,
    fontWeight: "600",
  },
  voiceHint: {
    marginTop: 12,
    color: "#665D4C",
    fontSize: 14,
    lineHeight: 21,
  },
  controlsCard: {
    borderRadius: 24,
    backgroundColor: "#FFF9F0",
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: "#E7D7C2",
  },
  statusPanel: {
    marginTop: 4,
    gap: 8,
    borderRadius: 18,
    backgroundColor: "#F5EEE1",
    padding: 12,
    borderWidth: 1,
    borderColor: "#E7D7C2",
  },
  statusRowInline: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusChip: {
    borderRadius: 999,
    backgroundColor: "#E4F2EE",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusChipLabel: {
    color: "#0F6C5B",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  statusPercentLabel: {
    color: "#5E4C38",
    fontSize: 12,
    fontWeight: "800",
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: "#E7DAC8",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#0F6C5B",
  },
  analysisBlock: {
    marginTop: 4,
    gap: 10,
  },
  analysisMeta: {
    color: "#7E5D3D",
    fontSize: 12,
    fontWeight: "700",
  },
  analysisChips: {
    gap: 10,
  },
  analysisChip: {
    borderRadius: 18,
    backgroundColor: "#F5EEE1",
    padding: 12,
    borderWidth: 1,
    borderColor: "#E7D7C2",
  },
  analysisChipTitle: {
    color: "#1E1A16",
    fontSize: 13,
    fontWeight: "800",
  },
  analysisChipText: {
    color: "#665D4C",
    fontSize: 12,
    lineHeight: 18,
  },
  warningStack: {
    gap: 6,
  },
  warningText: {
    color: "#A35528",
    fontSize: 12,
    lineHeight: 18,
  },
  inputBlock: {
    gap: 8,
  },
  inputLabel: {
    color: "#473B2F",
    fontSize: 14,
    fontWeight: "700",
  },
  input: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E4D7C2",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#1E1A16",
    fontSize: 15,
  },
  primaryButton: {
    marginTop: 6,
    borderRadius: 999,
    backgroundColor: "#0F6C5B",
    paddingVertical: 14,
    alignItems: "center",
    shadowColor: "#0F6C5B",
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
  },
  primaryButtonLabel: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  secondaryButton: {
    marginTop: 6,
    borderRadius: 999,
    backgroundColor: "#F0E6D7",
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryButtonLabel: {
    color: "#5E4C38",
    fontSize: 15,
    fontWeight: "800",
  },
  inlineError: {
    borderRadius: 18,
    backgroundColor: "#FFF0E5",
    padding: 14,
    borderWidth: 1,
    borderColor: "#F1D0BA",
  },
});
