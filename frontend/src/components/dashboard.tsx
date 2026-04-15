"use client";

import { useEffect, useState, useTransition } from "react";

type HealthResponse = {
  status: string;
  service: string;
};

type Score = {
  id: string;
  title: string;
  composer: string;
  format: string;
  uploaded_at: string;
  extraction_accuracy: number;
};

type PracticeLog = {
  id: string;
  singer_name: string;
  voice_part: "Soprano" | "Alto" | "Tenor" | "Bass";
  completion: number;
  feedback: string;
  score_title: string;
  recorded_at: string;
};

type VoiceCard = {
  part: "Soprano" | "Alto" | "Tenor" | "Bass";
  range: string;
  color: string;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8000";
const DEMO_API_PREFIX = "/api/demo";

const voiceCards: VoiceCard[] = [
  { part: "Soprano", range: "C4 - A5", color: "from-[#b64d57] to-[#7d2431]" },
  { part: "Alto", range: "G3 - D5", color: "from-[#d28d1c] to-[#996013]" },
  { part: "Tenor", range: "C3 - G4", color: "from-[#3478a3] to-[#1f4f71]" },
  { part: "Bass", range: "E2 - C4", color: "from-[#5f4ea8] to-[#3c3172]" },
];

const supportedFormats = ["PDF", "MUSICXML", "MIDI"] as const;

async function readJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export function Dashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [scores, setScores] = useState<Score[]>([]);
  const [logs, setLogs] = useState<PracticeLog[]>([]);
  const [scoreTitle, setScoreTitle] = useState("");
  const [composer, setComposer] = useState("");
  const [format, setFormat] = useState<(typeof supportedFormats)[number]>("MUSICXML");
  const [singerName, setSingerName] = useState("");
  const [voicePart, setVoicePart] = useState<PracticeLog["voice_part"]>("Soprano");
  const [completion, setCompletion] = useState(75);
  const [feedback, setFeedback] = useState("");
  const [selectedPart, setSelectedPart] = useState<VoiceCard["part"]>("Soprano");
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const refreshData = async () => {
    try {
      const [healthData, scoresData, logsData] = await Promise.all([
        readJson<HealthResponse>("/api/health"),
        readJson<Score[]>(`${DEMO_API_PREFIX}/scores`),
        readJson<PracticeLog[]>(`${DEMO_API_PREFIX}/practice-logs`),
      ]);
      setHealth(healthData);
      setScores(scoresData);
      setLogs(logsData);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to connect to the backend service.",
      );
    }
  };

  useEffect(() => {
    startTransition(() => {
      void refreshData();
    });
  }, []);

  async function handleScoreSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const title = scoreTitle.trim();
    const source = composer.trim();
    if (!title || !source) {
      setErrorMessage("Provide both the score title and composer before submitting.");
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({
            title,
            composer: source,
            format,
          });

          await readJson<Score>(`${DEMO_API_PREFIX}/mock-upload?${params.toString()}`, {
            method: "POST",
          });

          setScoreTitle("");
          setComposer("");
          setErrorMessage("");
          await refreshData();
        } catch (error) {
          setErrorMessage(
            error instanceof Error ? error.message : "Score upload simulation failed.",
          );
        }
      })();
    });
  }

  async function handlePracticeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const singer = singerName.trim();
    const note = feedback.trim();
    if (!singer || !note) {
      setErrorMessage("Provide the singer name and trainer feedback before saving.");
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          await readJson<PracticeLog>(`${DEMO_API_PREFIX}/practice-logs`, {
            method: "POST",
            body: JSON.stringify({
              singer_name: singer,
              voice_part: voicePart,
              completion,
              feedback: note,
              score_title: scores[0]?.title ?? "Unlinked practice session",
            }),
          });

          setSingerName("");
          setVoicePart("Soprano");
          setCompletion(75);
          setFeedback("");
          setErrorMessage("");
          await refreshData();
        } catch (error) {
          setErrorMessage(
            error instanceof Error ? error.message : "Practice log submission failed.",
          );
        }
      })();
    });
  }

  const averageAccuracy =
    scores.length === 0
      ? 0
      : Math.round(
          scores.reduce((total, score) => total + score.extraction_accuracy, 0) / scores.length,
        );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-8 md:px-8">
      <section className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
        <div className="rounded-[2rem] border border-line bg-surface p-8 shadow-[0_18px_50px_rgba(47,34,17,0.12)] backdrop-blur">
          <p className="mb-3 text-sm font-extrabold uppercase tracking-[0.24em] text-secondary">
            ChoirLift Dashboard
          </p>
          <h1 className="max-w-[11ch] text-5xl font-semibold leading-none tracking-tight md:text-7xl">
            Frontend and backend are now visible.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">
            Use this dashboard to simulate score uploads, view SATB practice areas, and log singer
            rehearsal progress. The backend API interface is also available through Swagger.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              className="rounded-full bg-primary px-5 py-3 font-semibold text-white transition hover:translate-y-[-1px]"
              href="#workspace"
            >
              Open Workspace
            </a>
            <a
              className="rounded-full bg-primary/8 px-5 py-3 font-semibold text-primary transition hover:translate-y-[-1px]"
              href={`${API_BASE_URL}/docs`}
              target="_blank"
              rel="noreferrer"
            >
              Open Backend Docs
            </a>
          </div>
        </div>

        <aside className="rounded-[2rem] border border-line bg-surface p-8 shadow-[0_18px_50px_rgba(47,34,17,0.12)] backdrop-blur">
          <h2 className="text-2xl font-semibold tracking-tight">System Status</h2>
          <div className="mt-5 space-y-4 text-muted">
            <div className="rounded-2xl border border-line bg-white/50 p-4">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-secondary">
                API Health
              </p>
              <p className="mt-2 text-lg font-semibold text-foreground">
                {health ? `${health.status} | ${health.service}` : "Checking backend..."}
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-white/50 p-4">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-secondary">
                Active Endpoints
              </p>
              <p className="mt-2">GET /api/health</p>
              <p>GET /api/demo/scores</p>
              <p>POST /api/demo/mock-upload</p>
              <p>GET | POST /api/demo/practice-logs</p>
            </div>
          </div>
        </aside>
      </section>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Scores" value={String(scores.length)} note="demo uploads saved in API memory" />
        <StatCard label="SATB Accuracy" value={`${averageAccuracy}%`} note="average extraction benchmark" />
        <StatCard label="Practice Logs" value={String(logs.length)} note="trainer records currently stored" />
        <StatCard
          label="Current Solo Part"
          value={selectedPart}
          note="frontend practice selection preview"
        />
      </section>

      {errorMessage ? (
        <section className="rounded-[1.6rem] border border-[#c56638]/30 bg-[#fff4eb] px-5 py-4 text-sm text-[#8a4a25]">
          {errorMessage}
        </section>
      ) : null}

      <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]" id="workspace">
        <section className="rounded-[2rem] border border-line bg-surface p-8 shadow-[0_18px_50px_rgba(47,34,17,0.08)]">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-secondary">
                Score Intake
              </p>
              <h2 className="text-3xl font-semibold tracking-tight">Upload a choir score</h2>
            </div>
            <span className="rounded-full bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">
              {isPending ? "Working..." : "Ready"}
            </span>
          </div>

          <form className="grid gap-4" onSubmit={handleScoreSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold">
                Score title
                <input
                  className="rounded-2xl border border-line bg-white/70 px-4 py-3 outline-none"
                  value={scoreTitle}
                  onChange={(event) => setScoreTitle(event.target.value)}
                  placeholder="e.g. Hallelujah Chorus"
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Composer
                <input
                  className="rounded-2xl border border-line bg-white/70 px-4 py-3 outline-none"
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  placeholder="e.g. G. F. Handel"
                />
              </label>
            </div>

            <label className="grid gap-2 text-sm font-semibold">
              Score format
              <select
                className="rounded-2xl border border-line bg-white/70 px-4 py-3 outline-none"
                value={format}
                onChange={(event) => setFormat(event.target.value as (typeof supportedFormats)[number])}
              >
                {supportedFormats.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <button
              className="w-fit rounded-full bg-primary px-5 py-3 font-semibold text-white transition hover:translate-y-[-1px]"
              type="submit"
            >
              Simulate Upload
            </button>
          </form>

          <div className="mt-6 grid gap-3">
            {scores.length === 0 ? (
              <EmptyBox text="No score uploaded yet. Submit one above to populate the workspace." />
            ) : (
              scores.map((score) => (
                <article
                  key={score.id}
                  className="rounded-2xl border border-line bg-white/55 px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <strong className="block text-lg">{score.title}</strong>
                      <p className="text-sm text-muted">
                        {score.composer} | {score.format} |{" "}
                        {new Date(score.uploaded_at).toLocaleString()}
                      </p>
                    </div>
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                      Accuracy {score.extraction_accuracy}%
                    </span>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="rounded-[2rem] border border-line bg-surface p-8 shadow-[0_18px_50px_rgba(47,34,17,0.08)]">
          <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-secondary">
            SATB Practice
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">Voice-part workspace</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {voiceCards.map((card) => (
              <button
                key={card.part}
                type="button"
                onClick={() => setSelectedPart(card.part)}
                className={`rounded-[1.7rem] bg-gradient-to-br ${card.color} p-5 text-left text-white shadow-[0_18px_40px_rgba(47,34,17,0.16)] transition hover:translate-y-[-1px] ${
                  selectedPart === card.part ? "ring-3 ring-white/60" : ""
                }`}
              >
                <p className="text-sm font-extrabold uppercase tracking-[0.18em] text-white/75">
                  Separated Voice
                </p>
                <h3 className="mt-2 text-2xl font-semibold">{card.part}</h3>
                <p className="mt-2 text-sm text-white/80">Range: {card.range}</p>
                <p className="mt-4 text-sm text-white/80">
                  Demo controls: solo, mute, export, and tempo adjustment will live here next.
                </p>
              </button>
            ))}
          </div>
        </section>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-[2rem] border border-line bg-surface p-8 shadow-[0_18px_50px_rgba(47,34,17,0.08)]">
          <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-secondary">
            Trainer Monitoring
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">Record practice progress</h2>
          <form className="mt-5 grid gap-4" onSubmit={handlePracticeSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold">
                Singer name
                <input
                  className="rounded-2xl border border-line bg-white/70 px-4 py-3 outline-none"
                  value={singerName}
                  onChange={(event) => setSingerName(event.target.value)}
                  placeholder="e.g. Jane Doe"
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Voice part
                <select
                  className="rounded-2xl border border-line bg-white/70 px-4 py-3 outline-none"
                  value={voicePart}
                  onChange={(event) => setVoicePart(event.target.value as PracticeLog["voice_part"])}
                >
                  {voiceCards.map((card) => (
                    <option key={card.part} value={card.part}>
                      {card.part}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="grid gap-2 text-sm font-semibold">
              Completion: {completion}%
              <input
                type="range"
                min="0"
                max="100"
                value={completion}
                onChange={(event) => setCompletion(Number(event.target.value))}
              />
            </label>

            <label className="grid gap-2 text-sm font-semibold">
              Trainer feedback
              <textarea
                className="min-h-32 rounded-2xl border border-line bg-white/70 px-4 py-3 outline-none"
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                placeholder="Pitch accuracy improved on the alto entrance."
              />
            </label>

            <button
              className="w-fit rounded-full bg-primary px-5 py-3 font-semibold text-white transition hover:translate-y-[-1px]"
              type="submit"
            >
              Save Practice Log
            </button>
          </form>
        </section>

        <section className="rounded-[2rem] border border-line bg-surface p-8 shadow-[0_18px_50px_rgba(47,34,17,0.08)]">
          <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-secondary">
            Progress History
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">Latest trainer records</h2>
          <div className="mt-5 grid gap-3">
            {logs.length === 0 ? (
              <EmptyBox text="No practice logs yet. Submit a trainer note to make this panel come alive." />
            ) : (
              logs.map((log) => (
                <article key={log.id} className="rounded-2xl border border-line bg-white/55 px-4 py-4">
                  <strong className="block text-lg">
                    {log.singer_name} | {log.voice_part}
                  </strong>
                  <p className="mt-1 text-sm text-muted">
                    Completion {log.completion}% | Score: {log.score_title}
                  </p>
                  <p className="mt-3 leading-7 text-muted">{log.feedback}</p>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-secondary">
                    {new Date(log.recorded_at).toLocaleString()}
                  </p>
                </article>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="rounded-[1.6rem] border border-line bg-surface p-6 shadow-[0_18px_50px_rgba(47,34,17,0.08)]">
      <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-secondary">{label}</p>
      <strong className="mt-3 block text-4xl font-semibold tracking-tight">{value}</strong>
      <p className="mt-2 text-sm leading-6 text-muted">{note}</p>
    </article>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-white/35 px-4 py-5 text-sm text-muted">
      {text}
    </div>
  );
}
