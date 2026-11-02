import { describe, expect, test } from "bun:test";
import {
  guessMimeTypeFromPath,
  isAudioExt,
  isImageExt,
  isVideoExt,
  normalizeGeminiInlineMimeType
} from "../src/media/mime";
import {
  buildGeminiMultiSpeakerPrompt,
  buildGeminiSingleSpeakerPrompt,
  ensureSpeakerScript,
  normalizeGeminiTtsVoice,
  normalizeTtsLanguage,
  prepareGeminiTtsAudioForWhatsApp,
  toPacingInstruction,
  wrapPcm16LeAsWav
} from "../src/media/tts-audio";
import { buildPollinationsImageUrl, defaultImageCaption } from "../src/media/image";
import { boomErrorText, boomHttpStatus, stringifyErrorForLog } from "../src/errors";
import { shouldSuppressKnownLibsignalConsoleNoise } from "../src/log-noise-filter";

describe("mime helpers", () => {
  test("guessMimeTypeFromPath by (case-insensitive) extension", () => {
    expect(guessMimeTypeFromPath("/x/a.PDF")).toBe("application/pdf");
    expect(guessMimeTypeFromPath("a.jpeg")).toBe("image/jpeg");
    expect(guessMimeTypeFromPath("a.mp4")).toBe("video/mp4");
    expect(guessMimeTypeFromPath("a.unknown")).toBe("application/octet-stream");
    expect(guessMimeTypeFromPath("noext")).toBe("application/octet-stream");
  });

  test("extension classifiers expect a lowercase dotted extension", () => {
    expect(isImageExt(".png")).toBe(true);
    expect(isImageExt(".PNG")).toBe(false);
    expect(isVideoExt(".webm")).toBe(true);
    expect(isAudioExt(".ogg")).toBe(true);
    expect(isAudioExt(".mp4")).toBe(false);
  });

  test("normalizeGeminiInlineMimeType drops parameters and maps opus to ogg", () => {
    expect(normalizeGeminiInlineMimeType("audio/ogg; codecs=opus")).toBe("audio/ogg");
    expect(normalizeGeminiInlineMimeType("Audio/Opus")).toBe("audio/ogg");
    expect(normalizeGeminiInlineMimeType("IMAGE/PNG")).toBe("image/png");
    expect(normalizeGeminiInlineMimeType("")).toBe("application/octet-stream");
    expect(normalizeGeminiInlineMimeType(";x=1")).toBe("application/octet-stream");
  });
});

describe("TTS helpers", () => {
  test("normalizeTtsLanguage", () => {
    expect(normalizeTtsLanguage("BN")).toBe("bn");
    expect(normalizeTtsLanguage("en_US")).toBe("en-us");
    expect(normalizeTtsLanguage("english")).toBe("en");
    expect(normalizeTtsLanguage(undefined)).toBe("en");
  });

  test("normalizeGeminiTtsVoice matches known voices case-insensitively, else fallback, else Kore", () => {
    expect(normalizeGeminiTtsVoice("puck", "Kore")).toBe("Puck");
    expect(normalizeGeminiTtsVoice("nope", "zephyr")).toBe("Zephyr");
    expect(normalizeGeminiTtsVoice(undefined, "nope")).toBe("Kore");
  });

  test("pacing buckets", () => {
    expect(toPacingInstruction(0.8)).toContain("slow");
    expect(toPacingInstruction(1)).toBe("natural conversational pace");
    expect(toPacingInstruction(1.3)).toContain("fast");
  });

  test("ensureSpeakerScript keeps labelled scripts and alternates speakers otherwise", () => {
    expect(ensureSpeakerScript("A: hi\nB: yo", "A", "B")).toBe("A: hi B: yo");
    expect(ensureSpeakerScript("Hi there. How are you? Fine!", "A", "B")).toBe(
      "A: Hi there.\nB: How are you?\nA: Fine!"
    );
  });

  test("prompts embed the transcript, language and pacing", () => {
    const single = buildGeminiSingleSpeakerPrompt({ transcript: "hello", language: "bn", speed: 1 });
    expect(single.endsWith("TRANSCRIPT:\nhello")).toBe(true);
    expect(single).toContain("Language: bn.");
    const multi = buildGeminiMultiSpeakerPrompt({
      script: "one. two.",
      speaker1Name: "A",
      speaker2Name: "B",
      language: "en",
      speed: 2
    });
    expect(multi).toContain("Speakers are A and B.");
    expect(multi.endsWith("TRANSCRIPT:\nA: one.\nB: two.")).toBe(true);
  });

  test("wrapPcm16LeAsWav writes a valid 44-byte mono 16-bit header with clamped rate", () => {
    const pcm = Buffer.from([1, 2, 3, 4]);
    const wav = wrapPcm16LeAsWav(pcm, 24_000);
    expect(wav.length).toBe(48);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(36 + 4);
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(24_000);
    expect(wav.readUInt32LE(28)).toBe(48_000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(4);
    expect(wrapPcm16LeAsWav(pcm, 1).readUInt32LE(24)).toBe(8_000);
  });

  test("prepareGeminiTtsAudioForWhatsApp picks the right container", () => {
    const data = Buffer.from([0, 0]);
    expect(prepareGeminiTtsAudioForWhatsApp({ data, mimeType: "audio/ogg", sampleRateHz: 24000 })).toMatchObject({
      format: "ogg_opus",
      ptt: true,
      mimeType: "audio/ogg; codecs=opus"
    });
    expect(prepareGeminiTtsAudioForWhatsApp({ data, mimeType: "audio/x-wav", sampleRateHz: 24000 }).format).toBe("wav");
    const pcm = prepareGeminiTtsAudioForWhatsApp({ data, mimeType: "audio/L16;rate=24000", sampleRateHz: 24000 });
    expect(pcm.format).toBe("pcm_to_wav");
    expect(pcm.data.length).toBe(46);
    expect(prepareGeminiTtsAudioForWhatsApp({ data, mimeType: "audio/mpeg", sampleRateHz: 24000 }).format).toBe("audio_generic");
    expect(prepareGeminiTtsAudioForWhatsApp({ data, mimeType: "", sampleRateHz: 24000 }).format).toBe("pcm_to_wav");
  });
});

describe("image helpers", () => {
  test("pollinations URL clamps size/seed and encodes the styled prompt", () => {
    const url = buildPollinationsImageUrl({ prompt: "a cat", width: 10, height: 9999, seed: 0, style: "meme" });
    expect(url.startsWith("https://image.pollinations.ai/prompt/a%20cat.%20Meme-style")).toBe(true);
    expect(url).toContain("width=512&height=1536&seed=1&model=flux&nologo=true");
  });

  test("default captions", () => {
    expect(defaultImageCaption("quote_card", "x")).toBe("styled quote card");
    expect(defaultImageCaption("meme", "a  b")).toBe("meme drop: a b");
    expect(defaultImageCaption("image", "sunset")).toBe("image: sunset");
  });
});

describe("error helpers", () => {
  test("boomHttpStatus prefers a 4xx/5xx `data` over output.statusCode", () => {
    expect(boomHttpStatus({ data: 429, output: { statusCode: 500 } })).toBe(429);
    expect(boomHttpStatus({ data: "x", output: { statusCode: 503 } })).toBe(503);
    expect(boomHttpStatus({ output: { statusCode: 200 } })).toBeUndefined();
    expect(boomHttpStatus(null)).toBeUndefined();
    expect(boomHttpStatus("oops")).toBeUndefined();
  });

  test("boomErrorText joins message, payload message and status", () => {
    expect(
      boomErrorText({ message: "rate-overlimit", output: { payload: { message: "Too Many" }, statusCode: 429 } })
    ).toBe("rate-overlimit Too Many 429");
    expect(boomErrorText("plain")).toBe("plain");
    expect(boomErrorText(null)).toBe("");
    expect(boomErrorText(42)).toBe("42");
  });

  test("stringifyErrorForLog", () => {
    expect(stringifyErrorForLog(new Error("boom"))).toBe("boom");
    expect(stringifyErrorForLog({ a: 1 })).toBe("[object Object]");
  });
});

describe("libsignal console noise filter", () => {
  test("suppresses known session-churn lines, keeps everything else", () => {
    expect(shouldSuppressKnownLibsignalConsoleNoise(["Closing session:", { some: "obj" }])).toBe(true);
    expect(shouldSuppressKnownLibsignalConsoleNoise(["  closing   open session in favor of incoming prekey bundle"])).toBe(true);
    expect(shouldSuppressKnownLibsignalConsoleNoise(["Removing old closed session: x"])).toBe(true);
    expect(shouldSuppressKnownLibsignalConsoleNoise(["message from Deep: closing session soon"])).toBe(false);
    expect(shouldSuppressKnownLibsignalConsoleNoise([])).toBe(false);
    expect(shouldSuppressKnownLibsignalConsoleNoise([null, undefined, ""])).toBe(false);
  });
});
