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

async function extractAudioFromVideoFile(videoFile: File) {
  const tempDir = await mkdtemp(join(tmpdir(), "vibecut-"));
  const inputExt = extname(videoFile.name) || ".mp4";
  const inputPath = join(tempDir, `input${inputExt}`);
  const outputPath = join(tempDir, "audio.mp3");

  try {
    const buffer = Buffer.from(await videoFile.arrayBuffer());
    await writeFile(inputPath, buffer);

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
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "ffmpeg failed to extract audio from the uploaded video";
    throw new Error(`Audio extraction failed: ${message}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function getAudioPayload(req: Request) {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
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
  };
}

export async function POST(req: Request) {
  try {
    const { audioBase64, mimeType } = await getAudioPayload(req);

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

Format: [{"startTime": 0.0, "endTime": 5.2, "text": "spoken words here"}, ...]

Rules:
- Break into natural segments of roughly 5-15 seconds each
- startTime and endTime are in seconds as floating point numbers
- Timestamps must be accurate and non-overlapping
- Include all spoken words
- Each segment should be a complete thought or sentence when possible`,
            },
          ],
        },
      ],
    });

    const text = response.text?.trim() || "[]";
    const parsed = parseJsonResponse(text);

    const segments = parsed.map(
      (seg: { startTime: number; endTime: number; text: string }) => ({
        id: uuid(),
        startTime: seg.startTime,
        endTime: seg.endTime,
        text: seg.text,
      })
    );

    return NextResponse.json({ segments });
  } catch (error) {
    console.error("Transcription error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Transcription failed" },
      { status: 500 }
    );
  }
}
