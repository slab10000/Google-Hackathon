"use client";
import { useState, useCallback } from "react";
import { TranscriptSegment } from "@/types";

export function useTranscript() {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transcribe = useCallback(async (audioBlob: Blob) => {
    setIsTranscribing(true);
    setError(null);
    try {
      const buffer = await audioBlob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );

      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: base64, mimeType: audioBlob.type }),
      });

      if (!res.ok) {
        throw new Error(`Transcription failed: ${res.statusText}`);
      }

      const data = await res.json();
      setSegments(data.segments);
      return data.segments as TranscriptSegment[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transcription failed";
      setError(msg);
      throw err;
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  const updateEmbeddings = useCallback((embeddings: number[][]) => {
    setSegments((prev) =>
      prev.map((seg, i) => ({ ...seg, embedding: embeddings[i] || seg.embedding }))
    );
  }, []);

  return { segments, isTranscribing, error, transcribe, updateEmbeddings, setSegments };
}
