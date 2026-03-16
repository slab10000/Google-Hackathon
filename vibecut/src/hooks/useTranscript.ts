"use client";
import { useState, useCallback } from "react";
import { extractAudio } from "@/lib/ffmpeg";
import { PauseRange, TranscriptSegment, TranscriptWord } from "@/types";

const DIRECT_VIDEO_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;

function buildAudioFileName(videoFileName: string) {
  return videoFileName.replace(/\.[^.]+$/, "") + ".mp3";
}

export function useTranscript() {
  const [activeJobs, setActiveJobs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const transcribe = useCallback(async (file: File, sourceClipId: string) => {
    setActiveJobs((count) => count + 1);
    setError(null);

    try {
      let res: Response;

      try {
        const audioBlob = await extractAudio(new Uint8Array(await file.arrayBuffer()));
        res = await fetch("/api/transcribe", {
          method: "POST",
          headers: {
            "Content-Type": audioBlob.type || "audio/mpeg",
            "X-Audio-Filename": encodeURIComponent(buildAudioFileName(file.name)),
          },
          body: audioBlob,
        });
      } catch (extractError) {
        if (file.size > DIRECT_VIDEO_UPLOAD_LIMIT_BYTES) {
          throw new Error(
            "Browser audio extraction failed, and this clip is too large for the deployed fallback upload. Try a shorter clip or re-export with standard audio."
          );
        }

        console.warn("Falling back to direct video upload for transcription", extractError);
        res = await fetch("/api/transcribe", {
          method: "POST",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-Video-Filename": encodeURIComponent(file.name),
          },
          body: file,
        });
      }

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (res.status === 413) {
          throw new Error("This upload is too large for the deployed transcription endpoint. Try a shorter clip.");
        }
        throw new Error(data?.error || `Transcription failed: ${res.statusText}`);
      }

      const data = await res.json();
      const segments = (data.segments as Array<
        Omit<TranscriptSegment, "sourceClipId" | "words"> & {
          words: Omit<TranscriptWord, "sourceClipId">[];
        }
      >).map((segment) => ({
        ...segment,
        sourceClipId,
        words: segment.words.map((word) => ({
          ...word,
          sourceClipId,
        })),
      }));

      const pauses = (data.pauses as Omit<PauseRange, "sourceClipId">[] | undefined)?.map((pause) => ({
        ...pause,
        sourceClipId,
      })) || [];

      return { segments, pauses };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transcription failed";
      setError(msg);
      throw err;
    } finally {
      setActiveJobs((count) => Math.max(0, count - 1));
    }
  }, []);

  const embedTexts = useCallback(async (texts: string[]) => {
    if (texts.length === 0) return [] as number[][];

    const res = await fetch("/api/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || `Embedding failed: ${res.statusText}`);
    }

    const data = await res.json();
    return data.embeddings as number[][];
  }, []);

  return {
    isTranscribing: activeJobs > 0,
    activeJobs,
    error,
    transcribe,
    embedTexts,
  };
}
