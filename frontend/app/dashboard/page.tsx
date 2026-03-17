"use client";

import { useState, useCallback, useEffect } from "react";
import { createJob, listStyles } from "@/lib/api";
import { useJobStatus } from "@/lib/useJobStatus";
import { AgentStatusBar } from "@/components/AgentStatusBar";
import { Style, JobStatus } from "@/types";
import Link from "next/link";

const DEFAULT_STYLES: Style[] = [
  { $id: "1", name: "Harvard Business School", style_id: "harvard_business", description: "HBS case study format", created_at: "" },
  { $id: "2", name: "Computer Science Thesis", style_id: "computer_science_thesis", description: "IEEE-style CS thesis", created_at: "" },
  { $id: "3", name: "APA Research Paper", style_id: "apa_research", description: "APA 7th edition format", created_at: "" },
  { $id: "4", name: "Engineering Report", style_id: "engineering_report", description: "Technical engineering report", created_at: "" },
];

export default function DashboardPage() {
  const [topic, setTopic] = useState("");
  const [selectedStyleId, setSelectedStyleId] = useState("");
  const [styles, setStyles] = useState<Style[]>(DEFAULT_STYLES);
  const [jobId, setJobId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalDocument, setFinalDocument] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);

  useEffect(() => {
    listStyles()
      .then((s) => {
        if (s.length > 0) setStyles(s as Style[]);
      })
      .catch(() => {
        // Use defaults if backend not available
      });
  }, []);

  const handleCompleted = useCallback((doc: string) => {
    setFinalDocument(doc);
    setJobStatus("completed");
  }, []);

  const handleFailed = useCallback((err: string) => {
    setError(err);
    setJobStatus("failed");
  }, []);

  const { status, currentAgent, isConnected } = useJobStatus({
    jobId,
    onCompleted: handleCompleted,
    onFailed: handleFailed,
  });

  const effectiveStatus = status ?? jobStatus;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || !selectedStyleId) return;

    setIsSubmitting(true);
    setError(null);
    setFinalDocument(null);
    setJobId(null);
    setJobStatus(null);

    try {
      const result = await createJob(topic.trim(), selectedStyleId);
      setJobId(result.job_id);
      setJobStatus(result.status as JobStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start job");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setJobId(null);
    setFinalDocument(null);
    setError(null);
    setJobStatus(null);
    setTopic("");
    setSelectedStyleId("");
  };

  const isRunning =
    effectiveStatus &&
    !["completed", "failed"].includes(effectiveStatus);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="border-b border-slate-700 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
              AI
            </div>
            <h1 className="text-xl font-bold text-white">ProjectAi</h1>
            <span className="text-slate-400 text-sm">Academic Research Engine</span>
          </div>
          <nav className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="text-blue-400 text-sm font-medium hover:text-blue-300 transition-colors"
            >
              Dashboard
            </Link>
            <Link
              href="/admin"
              className="text-slate-400 text-sm hover:text-white transition-colors"
            >
              Admin
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-white mb-4">
            Autonomous Academic Research
          </h2>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Enter your project topic, select a style profile, and let our multi-agent
            AI system research, write, and review a comprehensive academic project.
          </p>
        </div>

        {/* Main Form */}
        {!jobId && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8">
              <h3 className="text-lg font-semibold text-white mb-6">
                Start a New Project
              </h3>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Topic Input */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Project Topic
                  </label>
                  <textarea
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g., The impact of artificial intelligence on supply chain management in the automotive industry"
                    rows={3}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    disabled={isSubmitting}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    {topic.length}/500 characters — be specific for better results
                  </p>
                </div>

                {/* Style Dropdown */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Project Style Profile
                  </label>
                  <select
                    value={selectedStyleId}
                    onChange={(e) => setSelectedStyleId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={isSubmitting}
                  >
                    <option value="">Select a style profile...</option>
                    {styles.map((style) => (
                      <option key={style.$id} value={style.style_id}>
                        {style.name}
                        {style.description ? ` — ${style.description}` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    Upload custom style profiles in the{" "}
                    <Link href="/admin" className="text-blue-400 hover:underline">
                      Admin panel
                    </Link>
                  </p>
                </div>

                {error && (
                  <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
                    ⚠️ {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting || !topic.trim() || !selectedStyleId}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg px-6 py-3 transition-colors"
                >
                  {isSubmitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                      Starting research pipeline...
                    </span>
                  ) : (
                    "🚀 Generate Project"
                  )}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Job Progress View */}
        {jobId && !finalDocument && effectiveStatus !== "failed" && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-white">
                  Research in Progress
                </h3>
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-400 animate-pulse" : "bg-yellow-400"}`}
                  />
                  <span className="text-xs text-slate-400">
                    {isConnected ? "Live updates" : "Polling..."}
                  </span>
                </div>
              </div>

              {/* Job info */}
              <div className="bg-slate-900 rounded-lg p-4 mb-6 text-sm">
                <div className="flex gap-4 flex-wrap">
                  <div>
                    <span className="text-slate-500">Job ID: </span>
                    <span className="text-slate-300 font-mono text-xs">{jobId}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Style: </span>
                    <span className="text-slate-300">{selectedStyleId}</span>
                  </div>
                </div>
                <div className="mt-2">
                  <span className="text-slate-500">Topic: </span>
                  <span className="text-slate-300">{topic}</span>
                </div>
              </div>

              {/* Agent Status Bar */}
              <div className="bg-slate-900 rounded-xl p-6">
                <AgentStatusBar
                  status={effectiveStatus ?? "planning"}
                  currentAgent={currentAgent ?? "planner"}
                />
              </div>

              {/* Status message */}
              <div className="mt-4 text-center">
                {isRunning && (
                  <p className="text-slate-400 text-sm animate-pulse">
                    {effectiveStatus === "planning" && "🧠 Analyzing style guidelines and creating project outline..."}
                    {effectiveStatus === "researching" && "🔍 Searching web and deep-scraping academic sources..."}
                    {effectiveStatus === "writing" && "✍️ Drafting chapters with proper citations..."}
                    {effectiveStatus === "reviewing" && "🔎 Reviewing for style compliance and hallucinations..."}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Error View */}
        {effectiveStatus === "failed" && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-red-900/20 border border-red-700 rounded-2xl p-8 text-center">
              <div className="text-4xl mb-4">❌</div>
              <h3 className="text-lg font-semibold text-white mb-2">Job Failed</h3>
              <p className="text-red-300 text-sm mb-6">{error ?? "An error occurred during processing"}</p>
              <button
                onClick={handleReset}
                className="bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg px-6 py-3 transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* Final Document View */}
        {finalDocument && (
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">✅</span>
                  <h3 className="text-lg font-semibold text-white">
                    Project Generated Successfully
                  </h3>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      const blob = new Blob([finalDocument], { type: "text/markdown" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${topic.slice(0, 30).replace(/\s+/g, "_")}.md`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
                  >
                    ⬇️ Download .md
                  </button>
                  <button
                    onClick={handleReset}
                    className="bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
                  >
                    New Project
                  </button>
                </div>
              </div>
            </div>

            {/* Document preview */}
            <div className="bg-white rounded-2xl p-8 max-h-[70vh] overflow-y-auto">
              <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono leading-relaxed">
                {finalDocument}
              </pre>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
