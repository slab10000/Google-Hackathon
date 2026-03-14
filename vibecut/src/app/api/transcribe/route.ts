import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { getGeminiClient, MODELS } from "@/lib/gemini";
import { v4 as uuid } from "uuid";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const maxDuration = 60;

function parseJsonResponse(text: string) {
  const cleaned = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

type ParsedWord = {
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
};

type ParsedSegment = {
  startTime: number;
  endTime: number;
  text: string;
  words?: ParsedWord[];
};

type NormalizedWord = {
  id: string;
  segmentId: string;
  text: string;
  startTime: number;
  endTime: number;
  confidence: number | undefined;
};

type NormalizedSegment = {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  words: NormalizedWord[];
};

function normalizeSeconds(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildApproximateWords(segmentId: string, text: string, startTime: number, endTime: number): NormalizedWord[] {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return [];

  const duration = Math.max(endTime - startTime, 0.12);
  const weights = tokens.map((token) => Math.max(token.replace(/[^a-zA-Z0-9]+/g, "").length, 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let cursor = startTime;
  return tokens.map((token, index) => {
    const sliceDuration =
      index === tokens.length - 1 ? endTime - cursor : (duration * weights[index]) / Math.max(totalWeight, 1);
    const wordStart = cursor;
    const wordEnd = index === tokens.length - 1 ? endTime : Math.min(endTime, cursor + sliceDuration);
    cursor = wordEnd;

    return {
      id: uuid(),
      segmentId,
      text: token,
      startTime: wordStart,
      endTime: Math.max(wordEnd, wordStart + 0.01),
      confidence: undefined,
    };
  });
}

function normalizeWords(segmentId: string, segment: ParsedSegment): NormalizedWord[] {
  const segmentStart = normalizeSeconds(segment.startTime, 0);
  const segmentEnd = Math.max(normalizeSeconds(segment.endTime, segmentStart), segmentStart + 0.01);
  const fallbackWords = buildApproximateWords(segmentId, segment.text, segmentStart, segmentEnd);

  if (!Array.isArray(segment.words) || segment.words.length === 0) return fallbackWords;

  let previousEnd = segmentStart;
  const normalized = segment.words
    .map((word, index) => {
      const text = typeof word.text === "string" ? word.text.trim() : "";
      if (!text) return null;

      const rawStart = normalizeSeconds(word.startTime, previousEnd);
      const rawEnd = normalizeSeconds(word.endTime, rawStart + 0.05);
      const isLastWord = index === segment.words!.length - 1;
      const wordStart = Math.max(segmentStart, Math.min(rawStart, segmentEnd));
      const wordEnd = Math.max(
        wordStart + 0.01,
        Math.min(segmentEnd, isLastWord ? segmentEnd : rawEnd)
      );

      previousEnd = wordEnd;

      return {
        id: uuid(),
        segmentId,
        text,
        startTime: wordStart,
        endTime: wordEnd,
        confidence: typeof word.confidence === "number" ? word.confidence : undefined,
      };
    })
    .filter((word): word is NormalizedWord => Boolean(word));

  if (normalized.length === 0) return fallbackWords;
  return normalized;
}

async function detectPauseRanges(audioPath: string) {
  const { stderr } = await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-i",
    audioPath,
    "-af",
    "silencedetect=noise=-35dB:d=0.2",
    "-f",
    "null",
    "-",
  ]);

  const pauses: Array<{ id: string; startTime: number; endTime: number; duration: number }> = [];
  let pendingStart: number | null = null;

  for (const line of stderr.split("\n")) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
    if (startMatch) {
      pendingStart = parseFloat(startMatch[1]);
      continue;
    }

    const endMatch = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
    if (!endMatch) continue;

    const endTime = parseFloat(endMatch[1]);
    const duration = parseFloat(endMatch[2]);
    const startTime = pendingStart ?? Math.max(0, endTime - duration);
    pendingStart = null;

    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || duration < 0.2) continue;

    pauses.push({
      id: uuid(),
      startTime,
      endTime,
      duration,
    });
  }

  return pauses;
}

async function hasAudioStream(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "stream=codec_type",
      "-of", "csv=p=0",
      filePath
    ]);
    return stdout.split("\n").some(line => line.trim() === "audio");
  } catch (error) {
    console.warn("ffprobe check failed, assuming no audio", error);
    return false;
  }
}

async function extractAudioFromVideoFile(videoFile: File) {
  const tempDir = await mkdtemp(join(tmpdir(), "vibecut-"));
  const inputExt = extname(videoFile.name) || ".mp4";
  const inputPath = join(tempDir, `input${inputExt}`);
  const outputPath = join(tempDir, "audio.mp3");

  try {
    const buffer = Buffer.from(await videoFile.arrayBuffer());
    await writeFile(inputPath, buffer);

    const audioExists = await hasAudioStream(inputPath);
    if (!audioExists) {
      return {
        audioBase64: null,
        mimeType: null,
        audioPath: null,
        cleanupPath: tempDir,
      };
    }

    await execFileAsync("ffmpeg", [
      "-i",
      inputPath,
      "-vn",
      "-acodec",
      "libmp3lame",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-b:a",
      "64k",
      "-y",
      outputPath,
    ]);

    const audioBuffer = await readFile(outputPath);
    return {
      audioBase64: audioBuffer.toString("base64"),
      mimeType: "audio/mpeg",
      audioPath: outputPath,
      cleanupPath: tempDir,
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    const message =
      error instanceof Error
        ? error.message
        : "ffmpeg failed to extract audio from the uploaded video";
    throw new Error(`Audio extraction failed: ${message}`);
  }
}

async function getAudioPayload(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  const rawVideoFileName = req.headers.get("x-video-filename");

  if (rawVideoFileName) {
    const buffer = await req.arrayBuffer();
    const file = new File([buffer], decodeURIComponent(rawVideoFileName), {
      type: contentType || "application/octet-stream",
    });

    return extractAudioFromVideoFile(file);
  }

  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      throw new Error("Failed to parse upload body. Please retry the video upload.");
    }

    const video = formData.get("video");

    if (!(video instanceof File)) {
      throw new Error("No video file provided");
    }

    return extractAudioFromVideoFile(video);
  }

  const { audioBase64, mimeType } = await req.json();

  if (!audioBase64) {
    throw new Error("No audio data provided");
  }

  return {
    audioBase64,
    mimeType: mimeType || "audio/mp3",
    audioPath: null,
    cleanupPath: null,
  };
}

export async function POST(req: Request) {
  let cleanupPath: string | null = null;
  try {
    const { audioBase64, mimeType, audioPath, cleanupPath: payloadCleanupPath } = await getAudioPayload(req);
    cleanupPath = payloadCleanupPath;

    if (!audioBase64) {
      return NextResponse.json({ segments: [], pauses: [] });
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: MODELS.REASONING,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
            {
              text: `Transcribe this audio with precise timestamps. Return ONLY valid JSON (no markdown fences, no extra text).

Format:
{
  "segments": [
    {
      "startTime": 0.0,
      "endTime": 5.2,
      "text": "spoken words here",
      "words": [
        { "text": "spoken", "startTime": 0.0, "endTime": 0.4 },
        { "text": "words", "startTime": 0.4, "endTime": 0.9 }
      ]
    }
  ]
}

Rules:
- Break into natural segments of roughly 3-10 seconds each
- startTime and endTime are in seconds as floating point numbers
- Timestamps must be accurate and non-overlapping
- Include all spoken words
- Each segment should be a complete thought or sentence when possible
- Include a "words" array for every segment
- Every word must stay inside its parent segment time range
- Keep punctuation attached to the nearest word`,
            },
          ],
        },
      ],
    });

    const text = response.text?.trim() || "[]";
    const parsed = parseJsonResponse(text);
    const rawSegments: ParsedSegment[] = Array.isArray(parsed)
      ? (parsed as ParsedSegment[])
      : Array.isArray(parsed?.segments)
      ? (parsed.segments as ParsedSegment[])
      : [];

    const segments = rawSegments.reduce((accumulator: NormalizedSegment[], seg) => {
        const id = uuid();
        const startTime = normalizeSeconds(seg.startTime, 0);
        const endTime = Math.max(normalizeSeconds(seg.endTime, startTime), startTime + 0.01);
        const text = typeof seg.text === "string" ? seg.text.trim() : "";

        if (!text) return accumulator;

        accumulator.push({
          id,
          startTime,
          endTime,
          text,
          words: normalizeWords(id, { ...seg, startTime, endTime, text }),
        });

        return accumulator;
      }, []);

    const pauses = audioPath ? await detectPauseRanges(audioPath) : [];

    return NextResponse.json({ segments, pauses });
  } catch (error) {
    console.error("Transcription error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Transcription failed" },
      { status: 500 }
    );
  } finally {
    if (cleanupPath) {
      await rm(cleanupPath, { recursive: true, force: true });
    }
  }
}
