"use client";

import { useState, useRef } from "react";
import { uploadDocument } from "@/lib/api";
import Link from "next/link";

interface UploadResult {
  success: boolean;
  document_name: string;
  style_id: string;
  chunks_processed: number;
  message: string;
}

export default function AdminPage() {
  const [file, setFile] = useState<File | null>(null);
  const [styleId, setStyleId] = useState("");
  const [styleName, setStyleName] = useState("");
  const [description, setDescription] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setResult(null);
      setError(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) {
      setFile(dropped);
      setResult(null);
      setError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !styleId || !styleName) return;

    setIsUploading(true);
    setError(null);
    setResult(null);

    try {
      const res = await uploadDocument(file, styleId, styleName, description || undefined);
      setResult({
        ...res,
        document_name: file.name,
        style_id: styleId,
      });
      // Reset form
      setFile(null);
      setStyleId("");
      setStyleName("");
      setDescription("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

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
            <span className="text-slate-400 text-sm">Admin Panel</span>
          </div>
          <nav className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="text-slate-400 text-sm hover:text-white transition-colors"
            >
              Dashboard
            </Link>
            <Link
              href="/admin"
              className="text-blue-400 text-sm font-medium hover:text-blue-300 transition-colors"
            >
              Admin
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="mb-10">
          <h2 className="text-3xl font-bold text-white mb-3">
            Knowledge Base Management
          </h2>
          <p className="text-slate-400">
            Upload reference documents to expand the available Style Profiles.
            Each document is chunked, embedded with Gemini, and stored in
            Pinecone with strict{" "}
            <code className="text-blue-400 bg-slate-800 px-1 rounded">
              style_id
            </code>{" "}
            metadata tagging.
          </p>
        </div>

        {/* Upload Form */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8">
          <h3 className="text-lg font-semibold text-white mb-6">
            Upload Reference Document
          </h3>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* File Drop Zone */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Reference Document
              </label>
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
                  ${
                    file
                      ? "border-blue-500 bg-blue-900/10"
                      : "border-slate-600 hover:border-slate-500 bg-slate-900/50"
                  }
                `}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,.md"
                  onChange={handleFileChange}
                  className="hidden"
                />
                {file ? (
                  <div>
                    <div className="text-3xl mb-2">📄</div>
                    <p className="text-white font-medium">{file.name}</p>
                    <p className="text-slate-400 text-sm mt-1">
                      {formatFileSize(file.size)}
                    </p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="mt-2 text-red-400 text-xs hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="text-3xl mb-2">📁</div>
                    <p className="text-slate-300 font-medium">
                      Drop your file here or click to browse
                    </p>
                    <p className="text-slate-500 text-sm mt-1">
                      Supports PDF, DOCX, TXT, Markdown — max 50MB
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Style ID */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Style ID{" "}
                <span className="text-slate-500 text-xs">(unique identifier)</span>
              </label>
              <input
                type="text"
                value={styleId}
                onChange={(e) =>
                  setStyleId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))
                }
                placeholder="e.g., harvard_business"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isUploading}
              />
              <p className="mt-1 text-xs text-slate-500">
                Lowercase letters, numbers, and underscores only. This is used
                for Pinecone metadata filtering.
              </p>
            </div>

            {/* Style Name */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Style Name{" "}
                <span className="text-slate-500 text-xs">(display name)</span>
              </label>
              <input
                type="text"
                value={styleName}
                onChange={(e) => setStyleName(e.target.value)}
                placeholder="e.g., Harvard Business School"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isUploading}
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Description{" "}
                <span className="text-slate-500 text-xs">(optional)</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., HBS case study format with in-text citations"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isUploading}
              />
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
                ⚠️ {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isUploading || !file || !styleId || !styleName}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg px-6 py-3 transition-colors"
            >
              {isUploading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Processing and ingesting document...
                </span>
              ) : (
                "⬆️ Upload & Ingest to Knowledge Base"
              )}
            </button>
          </form>
        </div>

        {/* Success Result */}
        {result && (
          <div className="mt-6 bg-green-900/20 border border-green-700 rounded-2xl p-6">
            <div className="flex items-start gap-3">
              <span className="text-2xl">✅</span>
              <div>
                <h4 className="text-green-400 font-semibold mb-2">
                  Document ingested successfully!
                </h4>
                <dl className="space-y-1 text-sm">
                  <div className="flex gap-2">
                    <dt className="text-slate-400">Document:</dt>
                    <dd className="text-white">{result.document_name}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-slate-400">Style ID:</dt>
                    <dd className="text-white font-mono">{result.style_id}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-slate-400">Chunks processed:</dt>
                    <dd className="text-white">{result.chunks_processed}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-slate-400">Status:</dt>
                    <dd className="text-green-400">{result.message}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="mt-6 bg-slate-800/50 border border-slate-700 rounded-xl p-5 text-sm text-slate-400">
          <h4 className="text-slate-300 font-medium mb-2">
            ℹ️ How Knowledge Base Ingestion Works
          </h4>
          <ol className="list-decimal list-inside space-y-1">
            <li>Document text is extracted and split into ~800-word semantic chunks</li>
            <li>
              Supported formats: <strong className="text-slate-300">PDF, DOCX, TXT, Markdown</strong>
              {" "}— legacy <code className="text-blue-400">.doc</code> must be converted to{" "}
              <code className="text-blue-400">.docx</code> first
            </li>
            <li>Each chunk is embedded using Gemini <code className="text-blue-400">gemini-embedding-001</code></li>
            <li>
              Embedding dimensions are <strong className="text-slate-300">auto-matched</strong> to
              your Pinecone index size (no manual configuration needed)
            </li>
            <li>
              Vectors are upserted to Pinecone with{" "}
              <code className="text-blue-400">style_id</code> metadata
            </li>
            <li>The Planner Agent queries only chunks matching the selected style</li>
            <li>Style is registered in Appwrite for frontend dropdown</li>
          </ol>
        </div>
      </main>
    </div>
  );
}
