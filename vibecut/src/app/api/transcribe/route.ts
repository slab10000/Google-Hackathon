import { NextResponse } from "next/server";
import { getGeminiClient, MODELS } from "@/lib/gemini";
import { v4 as uuid } from "uuid";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { audioBase64, mimeType } = await req.json();

    if (!audioBase64) {
      return NextResponse.json({ error: "No audio data provided" }, { status: 400 });
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
                mimeType: mimeType || "audio/mp3",
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
    // Clean any potential markdown fences
    const cleaned = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned);

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
