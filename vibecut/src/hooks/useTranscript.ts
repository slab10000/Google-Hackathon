"use client";
import { useState, useCallback } from "react";
import { TranscriptSegment } from "@/types";

export function useTranscript() {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transcribe = useCallback(async (input: Blob | File) => {
    setIsTranscribing(true);
    setError(null);
    try {
      const isVideoFile = input instanceof File && input.type.startsWith("video/");
      const res = isVideoFile
        ? await (() => {
            const formData = new FormData();
            formData.append("video", input);
            return fetch("/api/transcribe", {
              method: "POST",
              body: formData,
            });
          })()
        : await (() => {
            const audioBlob = input;
            return audioBlob.arrayBuffer().then((buffer) => {
              const base64 = btoa(
                new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
              );

              return fetch("/api/transcribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ audioBase64: base64, mimeType: audioBlob.type }),
              });
            });
          })();

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Transcription failed: ${res.statusText}`);
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
