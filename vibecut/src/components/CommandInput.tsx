"use client";
import { useState } from "react";

interface CommandInputProps {
  onSubmit: (command: string) => void;
  isProcessing: boolean;
  lastExplanation?: string | null;
}

export default function CommandInput({ onSubmit, isProcessing, lastExplanation }: CommandInputProps) {
  const [value, setValue] = useState("");

  const handleSubmit = () => {
    if (value.trim() && !isProcessing) {
      onSubmit(value.trim());
      setValue("");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder='Try: "make this snappier", "remove the introduction", "cut filler words"...'
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          disabled={isProcessing}
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 focus:outline-none focus:border-violet-500/50 disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={isProcessing || !value.trim()}
          className="px-5 py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-2"
        >
          {isProcessing ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Edit
            </>
          )}
        </button>
      </div>
      {lastExplanation && (
        <p className="text-xs text-violet-300/70 px-1">{lastExplanation}</p>
      )}
    </div>
  );
}
