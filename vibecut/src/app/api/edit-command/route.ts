import { NextResponse } from "next/server";
import { getGeminiClient, MODELS } from "@/lib/gemini";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { command, transcript, timeline } = await req.json();

    if (!command) {
      return NextResponse.json({ error: "No command provided" }, { status: 400 });
    }

    const ai = getGeminiClient();

    const systemPrompt = `You are a video editing AI assistant. Given the current transcript segments and timeline clips, interpret the user's natural language editing command and return structured edit operations.

Available operation types:
- "remove_time_range": Remove video between startTime and endTime
- "keep_only_ranges": Keep only specified time ranges, remove everything else. Provide "ranges" array of {startTime, endTime}
- "insert_image": Generate and insert an image at afterTime with a prompt and duration
- "reorder": Move segment from one position to another. Provide fromIndex and toIndex
- "trim_to_duration": Trim the video to a target duration in seconds. Provide "targetDuration"

Return ONLY valid JSON (no markdown fences):
{
  "operations": [
    {"type": "remove_time_range", "startTime": number, "endTime": number, "reason": "string"},
    {"type": "keep_only_ranges", "ranges": [{"startTime": number, "endTime": number}], "reason": "string"},
    {"type": "insert_image", "afterTime": number, "prompt": "image description", "duration": number, "reason": "string"},
    {"type": "reorder", "fromIndex": number, "toIndex": number, "reason": "string"},
    {"type": "trim_to_duration", "targetDuration": number, "reason": "string"}
  ],
  "explanation": "brief description of what will be done"
}

Be conservative. Only make changes the user explicitly requests. Preserve meaning unless told otherwise.`;

    const response = await ai.models.generateContent({
      model: MODELS.REASONING,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${systemPrompt}

Current transcript segments:
${JSON.stringify(transcript, null, 2)}

Current timeline clips:
${JSON.stringify(timeline, null, 2)}

User command: "${command}"`,
            },
          ],
        },
      ],
    });

    const text = response.text?.trim() || "{}";
    const cleaned = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned);

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Edit command error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Edit command failed" },
      { status: 500 }
    );
  }
}
