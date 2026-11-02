import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { DATA_DIR } from "../config";
import { clampInt, compactText } from "../utils";

export const DEFAULT_GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";

export const GEMINI_TTS_VOICES = [
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat"
] as const;

export const GEMINI_TTS_VOICE_LOOKUP = new Map(
  GEMINI_TTS_VOICES.map((voice) => [voice.toLowerCase(), voice])
);

export const TTS_TMP_DIR = path.join(DATA_DIR, "tmp", "tts");

export function normalizeTtsLanguage(value: string | undefined): string {
  const compact = compactText(value ?? "").toLowerCase();
  if (!compact) return "en";
  if (/^[a-z]{2}$/.test(compact)) return compact;
  if (/^[a-z]{2}[-_][a-z]{2}$/.test(compact)) {
    return compact.replace("_", "-");
  }
  return "en";
}

export function normalizeGeminiTtsVoice(value: string | undefined, fallback: string): string {
  const compact = compactText(value ?? "").toLowerCase();
  if (compact) {
    const matched = GEMINI_TTS_VOICE_LOOKUP.get(compact);
    if (matched) return matched;
  }

  const fallbackMatched = GEMINI_TTS_VOICE_LOOKUP.get(fallback.toLowerCase());
  return fallbackMatched ?? "Kore";
}

export function buildGeminiSingleSpeakerPrompt(args: {
  transcript: string;
  language: string;
  speed: number;
}): string {
  return [
    "Read the transcript exactly as written. Do not add extra words or headings.",
    `Language: ${args.language}.`,
    `Pacing: ${toPacingInstruction(args.speed)}.`,
    "Style: expressive, natural, and conversational.",
    "TRANSCRIPT:",
    args.transcript
  ].join("\n");
}

export function buildGeminiMultiSpeakerPrompt(args: {
  script: string;
  speaker1Name: string;
  speaker2Name: string;
  language: string;
  speed: number;
}): string {
  const script = ensureSpeakerScript(args.script, args.speaker1Name, args.speaker2Name);
  return [
    "Generate two-speaker TTS dialogue exactly from the transcript.",
    `Speakers are ${args.speaker1Name} and ${args.speaker2Name}.`,
    `Language: ${args.language}.`,
    `Pacing: ${toPacingInstruction(args.speed)}.`,
    "Do not add any narration or extra lines.",
    "TRANSCRIPT:",
    script
  ].join("\n");
}

export function toPacingInstruction(speed: number): string {
  if (speed <= 0.8) return "slow and calm with clear pauses";
  if (speed >= 1.3) return "fast and energetic but still intelligible";
  return "natural conversational pace";
}

export function ensureSpeakerScript(script: string, speaker1Name: string, speaker2Name: string): string {
  const compact = compactText(script);
  const speaker1Pattern = new RegExp(`\\b${escapeRegExp(speaker1Name)}\\s*:`, "i");
  const speaker2Pattern = new RegExp(`\\b${escapeRegExp(speaker2Name)}\\s*:`, "i");
  if (speaker1Pattern.test(compact) && speaker2Pattern.test(compact)) {
    return compact;
  }

  const turns = compact
    .split(/(?<=[.!?])\s+/)
    .map((segment) => compactText(segment))
    .filter(Boolean)
    .slice(0, 10);

  if (turns.length === 0) {
    return `${speaker1Name}: ${compact}`;
  }

  return turns
    .map((turn, index) => `${index % 2 === 0 ? speaker1Name : speaker2Name}: ${turn}`)
    .join("\n");
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function wrapPcm16LeAsWav(pcmData: Buffer, sampleRateHz: number): Buffer {
  const safeRate = clampInt(sampleRateHz, 8_000, 96_000);
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = safeRate * blockAlign;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(safeRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([header, pcmData]);
}

export function prepareGeminiTtsAudioForWhatsApp(args: {
  data: Buffer;
  mimeType: string;
  sampleRateHz: number;
}): {
  data: Buffer;
  mimeType: string;
  ptt: boolean;
  format: "ogg_opus" | "wav" | "pcm_to_wav" | "audio_generic";
} {
  const normalizedMime = compactText(args.mimeType).toLowerCase();
  const baseMime = normalizedMime.split(";")[0]?.trim() || normalizedMime;

  if (
    normalizedMime.includes("audio/ogg") ||
    normalizedMime.includes("audio/opus") ||
    normalizedMime.includes("codecs=opus")
  ) {
    return {
      data: args.data,
      mimeType: "audio/ogg; codecs=opus",
      ptt: true,
      format: "ogg_opus"
    };
  }

  if (
    baseMime === "audio/wav" ||
    baseMime === "audio/x-wav" ||
    baseMime === "audio/wave"
  ) {
    return {
      data: args.data,
      mimeType: "audio/wav",
      ptt: false,
      format: "wav"
    };
  }

  if (
    normalizedMime.includes("audio/pcm") ||
    normalizedMime.includes("audio/l16") ||
    normalizedMime.includes("audio/raw") ||
    normalizedMime.includes("rate=")
  ) {
    return {
      data: wrapPcm16LeAsWav(args.data, args.sampleRateHz),
      mimeType: "audio/wav",
      ptt: false,
      format: "pcm_to_wav"
    };
  }

  if (baseMime.startsWith("audio/")) {
    return {
      data: args.data,
      mimeType: baseMime,
      ptt: false,
      format: "audio_generic"
    };
  }

  return {
    data: wrapPcm16LeAsWav(args.data, args.sampleRateHz),
    mimeType: "audio/wav",
    ptt: false,
    format: "pcm_to_wav"
  };
}

export async function transcodeAudioToOggOpus(args: {
  data: Buffer;
  mimeType: string;
  sampleRateHz: number;
}): Promise<Buffer | null> {
  const normalizedMime = compactText(args.mimeType).toLowerCase();
  const baseMime = normalizedMime.split(";")[0]?.trim() || normalizedMime;

  const wavInput =
    baseMime === "audio/wav" || baseMime === "audio/x-wav" || baseMime === "audio/wave"
      ? args.data
      : wrapPcm16LeAsWav(args.data, args.sampleRateHz);

  ensureTtsTempDir();
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const inPath = path.join(TTS_TMP_DIR, `in-${token}.wav`);
  const outPath = path.join(TTS_TMP_DIR, `out-${token}.ogg`);

  try {
    writeFileSync(inPath, wavInput);
    const ok = await runFfmpegOpusTranscode(inPath, outPath);
    if (!ok || !existsSync(outPath)) return null;
    const ogg = readFileSync(outPath);
    if (!ogg || ogg.length === 0) return null;
    return ogg;
  } catch {
    return null;
  } finally {
    safeRemoveFile(inPath);
    safeRemoveFile(outPath);
  }
}

export function ensureTtsTempDir(): void {
  if (!existsSync(TTS_TMP_DIR)) {
    mkdirSync(TTS_TMP_DIR, { recursive: true });
  }
}

export function runFfmpegOpusTranscode(inputWavPath: string, outputOggPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        inputWavPath,
        "-c:a",
        "libopus",
        "-b:a",
        "32k",
        "-vbr",
        "on",
        "-compression_level",
        "10",
        "-application",
        "voip",
        outputOggPath
      ],
      { windowsHide: true }
    );

    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

export function safeRemoveFile(filePath: string): void {
  try {
    rmSync(filePath, { force: true });
  } catch {
    // ignore best-effort temp cleanup failures
  }
}
