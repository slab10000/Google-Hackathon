import { NextResponse } from "next/server";
import { generateStyleSuggestion, generateTextImage, generateTextVideo } from "@/lib/ai-media";

export const maxDuration = 300; // 5 minutes max since video polling takes time

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body;

    if (!action) {
      return NextResponse.json({ error: "No action provided" }, { status: 400 });
    }

    if (action === "style") {
      const { text } = body;
      if (!text) return NextResponse.json({ error: "Missing text parameter" }, { status: 400 });
      const style = await generateStyleSuggestion(text);
      return NextResponse.json({ style });
    }

    if (action === "image") {
      const { text, style, typographyPrompt, referenceImage } = body;
      if (!text || !style) return NextResponse.json({ error: "Missing text or style parameters" }, { status: 400 });
      const result = await generateTextImage({ text, style, typographyPrompt, referenceImage });
      return NextResponse.json(result);
    }

    if (action === "video") {
      const { text, imageBase64, imageMimeType, style } = body;
      if (!text || !imageBase64 || !imageMimeType || !style) {
         return NextResponse.json({ error: "Missing required video parameters" }, { status: 400 });
      }
      const videoUri = await generateTextVideo(text, imageBase64, imageMimeType, style);
      return NextResponse.json({ videoUri });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  } catch (error) {
    console.error("VibeText API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error occurred" },
      { status: 500 }
    );
  }
}
