const STORAGE_KEY = "choirlift-state-v1";
const VOICE_PARTS = [
  { name: "Soprano", color: "#b64d57", frequency: 523.25, range: "C4 - A5" },
  { name: "Alto", color: "#d28d1c", frequency: 440.0, range: "G3 - D5" },
  { name: "Tenor", color: "#3478a3", frequency: 293.66, range: "C3 - G4" },
  { name: "Bass", color: "#5f4ea8", frequency: 196.0, range: "E2 - C4" }
];

const state = loadState();
let audioContext;
let activeOscillator;
let activeGainNode;
let activePartName = null;

const elements = {
  uploadForm: document.getElementById("upload-form"),
  scoreFile: document.getElementById("score-file"),
  scoreTitle: document.getElementById("score-title"),
  scoreComposer: document.getElementById("score-composer"),
  latestUpload: document.getElementById("latest-upload"),
  processingBadge: document.getElementById("processing-badge"),
  voiceParts: document.getElementById("voice-parts"),
  exportActions: document.getElementById("export-actions"),
  exportLog: document.getElementById("export-log"),
  progressForm: document.getElementById("progress-form"),
  singerName: document.getElementById("singer-name"),
  singerPart: document.getElementById("singer-part"),
  singerCompletion: document.getElementById("singer-completion"),
  singerFeedback: document.getElementById("singer-feedback"),
  completionValue: document.getElementById("completion-value"),
  activityLog: document.getElementById("activity-log"),
  scoreCount: document.getElementById("score-count"),
  accuracyRate: document.getElementById("accuracy-rate"),
  exportCount: document.getElementById("export-count"),
  activityCount: document.getElementById("activity-count"),
  tempoSlider: document.getElementById("tempo-slider"),
  tempoValue: document.getElementById("tempo-value"),
  seedDemo: document.getElementById("seed-demo")
};

render();
bindEvents();

function bindEvents() {
  elements.uploadForm.addEventListener("submit", handleUpload);
  elements.progressForm.addEventListener("submit", handleProgressSubmit);
  elements.singerCompletion.addEventListener("input", () => {
    elements.completionValue.textContent = `${elements.singerCompletion.value}%`;
  });
  elements.tempoSlider.addEventListener("input", () => {
    state.tempo = Number(elements.tempoSlider.value);
    elements.tempoValue.textContent = `${state.tempo}%`;
    if (activeOscillator) {
      const part = VOICE_PARTS.find((entry) => entry.name === activePartName);
      if (part) {
        activeOscillator.frequency.value = getAdjustedFrequency(part.frequency);
      }
    }
    persist();
  });
  elements.seedDemo.addEventListener("click", seedDemoData);
}

function handleUpload(event) {
  event.preventDefault();

  const file = elements.scoreFile.files[0];
  if (!file) {
    elements.processingBadge.textContent = "Choose a file first";
    return;
  }

  const title = elements.scoreTitle.value.trim() || file.name.replace(/\.[^/.]+$/, "");
  const composer = elements.scoreComposer.value.trim() || "Unknown source";
  const extension = file.name.split(".").pop().toLowerCase();

  elements.processingBadge.textContent = "Processing...";

  window.setTimeout(() => {
    const score = {
      id: createId(),
      title,
      composer,
      fileName: file.name,
      format: extension.toUpperCase(),
      uploadedAt: new Date().toISOString(),
      extractionAccuracy: 90 + Math.floor(Math.random() * 8),
      parts: VOICE_PARTS.map((part, index) => ({
        ...part,
        confidence: 88 + index * 2 + Math.floor(Math.random() * 4),
        measures: 24 + index * 8,
        muted: false
      }))
    };

    state.scores.unshift(score);
    state.currentScoreId = score.id;
    elements.uploadForm.reset();
    elements.processingBadge.textContent = "Score processed";
    persist();
    render();
  }, 900);
}

function handleProgressSubmit(event) {
  event.preventDefault();

  const entry = {
    id: createId(),
    singer: elements.singerName.value.trim(),
    part: elements.singerPart.value,
    completion: Number(elements.singerCompletion.value),
    feedback: elements.singerFeedback.value.trim() || "No written feedback.",
    scoreTitle: getCurrentScore()?.title || "No score linked",
    recordedAt: new Date().toISOString()
  };

  state.activities.unshift(entry);
  elements.progressForm.reset();
  elements.singerCompletion.value = "75";
  elements.completionValue.textContent = "75%";
  persist();
  render();
}

function render() {
  const currentScore = getCurrentScore();
  renderLatestUpload(currentScore);
  renderVoiceCards(currentScore);
  renderExportActions(currentScore);
  renderActivities();
  renderStats();
  elements.tempoSlider.value = String(state.tempo);
  elements.tempoValue.textContent = `${state.tempo}%`;
}

function renderLatestUpload(score) {
  if (!score) {
    elements.latestUpload.className = "latest-upload empty-state";
    elements.latestUpload.textContent = "No score processed yet.";
    return;
  }

  elements.latestUpload.className = "latest-upload";
  elements.latestUpload.innerHTML = `
    <strong>${escapeHtml(score.title)}</strong>
    <p>${escapeHtml(score.composer)} | ${escapeHtml(score.format)} | ${new Date(score.uploadedAt).toLocaleString()}</p>
    <div class="meta-row">
      <span>File: ${escapeHtml(score.fileName)}</span>
      <span>Extraction accuracy: ${score.extractionAccuracy}%</span>
      <span>${score.parts.length} voice parts detected</span>
    </div>
  `;
}

function renderVoiceCards(score) {
  if (!score) {
    elements.voiceParts.innerHTML = `<div class="empty-state">Upload a score to view SATB parts.</div>`;
    return;
  }

  elements.voiceParts.innerHTML = score.parts.map((part) => `
    <article class="voice-card" data-part="${part.name}">
      <div>
        <p class="panel-label" style="color: rgba(255,255,255,0.8);">Separated Voice</p>
        <h3>${part.name}</h3>
      </div>
      <p>Range: ${part.range}</p>
      <small>Confidence ${part.confidence}% | ${part.measures} measures available</small>
      <div class="part-actions">
        <button type="button" data-action="play" data-part="${part.name}">Play</button>
        <button type="button" data-action="solo" data-part="${part.name}" class="${state.soloPart === part.name ? "active" : ""}">Solo</button>
        <button type="button" data-action="mute" data-part="${part.name}" class="${part.muted ? "active" : ""}">${part.muted ? "Muted" : "Mute"}</button>
      </div>
    </article>
  `).join("");

  elements.voiceParts.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => handleVoiceAction(button.dataset.action, button.dataset.part));
  });
}

function renderExportActions(score) {
  const formats = ["Audio", "PDF", "MusicXML", "MIDI"];

  if (!score) {
    elements.exportActions.innerHTML = `<div class="empty-state">Exports become available after processing a score.</div>`;
    elements.exportLog.textContent = "No exports yet.";
    return;
  }

  elements.exportActions.innerHTML = formats.map((format) => `
    <button type="button" data-format="${format}">Export ${format}</button>
  `).join("");

  elements.exportActions.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => exportScore(button.dataset.format, score));
  });

  if (state.exports.length === 0) {
    elements.exportLog.textContent = "No exports yet.";
  } else {
    const latest = state.exports[0];
    elements.exportLog.textContent = `Latest export: ${latest.format} for "${latest.scoreTitle}" at ${new Date(latest.exportedAt).toLocaleString()}.`;
  }
}

function renderActivities() {
  if (state.activities.length === 0) {
    elements.activityLog.className = "activity-log empty-state";
    elements.activityLog.textContent = "No training activities recorded yet.";
    return;
  }

  elements.activityLog.className = "activity-log";
  elements.activityLog.innerHTML = state.activities.map((activity) => `
    <article class="activity-item">
      <strong>${escapeHtml(activity.singer)} | ${escapeHtml(activity.part)}</strong>
      <div class="meta-row">
        <span>Completion ${activity.completion}%</span>
        <span>Score: ${escapeHtml(activity.scoreTitle)}</span>
        <span>${new Date(activity.recordedAt).toLocaleString()}</span>
      </div>
      <p>${escapeHtml(activity.feedback)}</p>
    </article>
  `).join("");
}

function renderStats() {
  elements.scoreCount.textContent = String(state.scores.length);
  elements.accuracyRate.textContent = `${averageAccuracy()}%`;
  elements.exportCount.textContent = String(state.exports.length);
  elements.activityCount.textContent = String(state.activities.length);
}

function handleVoiceAction(action, partName) {
  const score = getCurrentScore();
  if (!score) {
    return;
  }

  const part = score.parts.find((entry) => entry.name === partName);
  if (!part) {
    return;
  }

  if (action === "mute") {
    part.muted = !part.muted;
  }

  if (action === "solo") {
    state.soloPart = state.soloPart === partName ? null : partName;
  }

  if (action === "play") {
    playPart(part);
  }

  persist();
  render();
}

function playPart(part) {
  if (part.muted) {
    return;
  }

  stopPlayback();

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  audioContext = audioContext || new AudioContextClass();
  activeOscillator = audioContext.createOscillator();
  activeGainNode = audioContext.createGain();

  activeOscillator.type = "sine";
  activeOscillator.frequency.value = getAdjustedFrequency(part.frequency);
  activeGainNode.gain.value = state.soloPart && state.soloPart !== part.name ? 0.02 : 0.12;

  activeOscillator.connect(activeGainNode);
  activeGainNode.connect(audioContext.destination);
  activeOscillator.start();
  activePartName = part.name;

  window.setTimeout(stopPlayback, 1600);
}

function stopPlayback() {
  if (activeOscillator) {
    activeOscillator.stop();
    activeOscillator.disconnect();
    activeGainNode.disconnect();
    activeOscillator = null;
    activeGainNode = null;
    activePartName = null;
  }
}

function exportScore(format, score) {
  const payload = {
    scoreTitle: score.title,
    format,
    exportedAt: new Date().toISOString(),
    parts: score.parts.map((part) => ({
      name: part.name,
      confidence: part.confidence,
      muted: part.muted
    }))
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${score.title.replace(/\s+/g, "-").toLowerCase()}-${format.toLowerCase()}.json`;
  link.click();
  URL.revokeObjectURL(url);

  state.exports.unshift({
    format,
    scoreTitle: score.title,
    exportedAt: new Date().toISOString()
  });
  persist();
  render();
}

function seedDemoData() {
  if (state.scores.length > 0 || state.activities.length > 0) {
    return;
  }

  const demoScore = {
    id: createId(),
    title: "Mwangaza wa Asubuhi",
    composer: "Department Choir Arrangement",
    fileName: "mwangaza-wa-asubuhi.musicxml",
    format: "MUSICXML",
    uploadedAt: new Date().toISOString(),
    extractionAccuracy: 94,
    parts: VOICE_PARTS.map((part, index) => ({
      ...part,
      confidence: 91 + index,
      measures: 28 + index * 6,
      muted: false
    }))
  };

  state.scores = [demoScore];
  state.currentScoreId = demoScore.id;
  state.activities = [
    {
      id: createId(),
      singer: "Grace Njeri",
      part: "Alto",
      completion: 82,
      feedback: "Steady blend and better entrance timing in section B.",
      scoreTitle: demoScore.title,
      recordedAt: new Date().toISOString()
    },
    {
      id: createId(),
      singer: "Daniel Otieno",
      part: "Tenor",
      completion: 68,
      feedback: "Needs slower repetition on leaps before full-tempo practice.",
      scoreTitle: demoScore.title,
      recordedAt: new Date(Date.now() - 86400000).toISOString()
    }
  ];
  persist();
  render();
}

function getCurrentScore() {
  return state.scores.find((score) => score.id === state.currentScoreId) || null;
}

function averageAccuracy() {
  if (state.scores.length === 0) {
    return 0;
  }

  const total = state.scores.reduce((sum, score) => sum + score.extractionAccuracy, 0);
  return Math.round(total / state.scores.length);
}

function getAdjustedFrequency(baseFrequency) {
  return baseFrequency * (state.tempo / 100);
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {
      scores: [],
      currentScoreId: null,
      activities: [],
      exports: [],
      soloPart: null,
      tempo: 100
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      scores: parsed.scores || [],
      currentScoreId: parsed.currentScoreId || null,
      activities: parsed.activities || [],
      exports: parsed.exports || [],
      soloPart: parsed.soloPart || null,
      tempo: parsed.tempo || 100
    };
  } catch (error) {
    return {
      scores: [],
      currentScoreId: null,
      activities: [],
      exports: [],
      soloPart: null,
      tempo: 100
    };
  }
}

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
