#!/usr/bin/env tsx
/**
 * ingestDocuments.ts
 *
 * Vector Database Metadata-Tagging Script
 * ----------------------------------------
 * Processes local reference documents (PDF/TXT/MD), chunks the text,
 * generates Gemini embeddings, and upserts to Pinecone with strict
 * style_id metadata tagging.
 *
 * Usage:
 *   npx tsx src/scripts/ingestDocuments.ts \
 *     --file ./references/harvard_business_sample.pdf \
 *     --style_id harvard_business \
 *     --style_name "Harvard Business School" \
 *     --description "HBS case study format"
 *
 *   Or use the config file approach:
 *   npx tsx src/scripts/ingestDocuments.ts --config ./ingest-config.json
 */

import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { resolve, extname } from "path";
import { v4 as uuidv4 } from "uuid";
import mammoth from "mammoth";
import { generateEmbedding } from "../lib/gemini.js";
import { upsertChunks, ChunkMetadata, getPineconeIndex, getIndexDimension } from "../lib/pinecone.js";
import { createStyle } from "../lib/appwrite.js";

// --- CLI Argument Parsing ---
interface IngestConfig {
  file?: string;
  style_id: string;
  style_name: string;
  description?: string;
}

interface ConfigFile {
  documents: IngestConfig[];
}

function parseArgs(): { config?: string } & Partial<IngestConfig> {
  const args = process.argv.slice(2);
  const result: { config?: string } & Partial<IngestConfig> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--file":
        result.file = args[++i];
        break;
      case "--style_id":
        result.style_id = args[++i];
        break;
      case "--style_name":
        result.style_name = args[++i];
        break;
      case "--description":
        result.description = args[++i];
        break;
      case "--config":
        result.config = args[++i];
        break;
    }
  }

  return result;
}

// --- Text Extraction ---
async function extractTextFromFile(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  const buffer = readFileSync(filePath);

  if (ext === ".pdf") {
    const pdfParse = await import("pdf-parse").then((m) => m.default ?? m);
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    if (result.messages.length > 0) {
      result.messages.forEach((msg) => {
        if (msg.type === "warning") {
          console.warn(`  ⚠ mammoth warning: ${msg.message}`);
        }
      });
    }
    return result.value;
  }

  if (ext === ".doc") {
    throw new Error(
      "Legacy .doc format is not supported. Please convert your file to .docx and re-upload."
    );
  }

  if (ext === ".txt" || ext === ".md" || ext === ".markdown") {
    return buffer.toString("utf-8");
  }

  throw new Error(`Unsupported file type: ${ext}. Supported: .pdf, .docx, .txt, .md`);
}

// --- Text Chunking ---
/**
 * Chunks text using a sliding window approach with sentence-boundary awareness.
 * CRITICAL: Each chunk will be embedded and tagged with style_id metadata.
 */
function chunkText(
  text: string,
  chunkSize = 800,
  overlap = 100
): string[] {
  // Normalize whitespace
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");

  // Split into sentences first for better semantic chunks
  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentWordCount = 0;

  for (const sentence of sentences) {
    const sentenceWordCount = sentence.split(/\s+/).length;

    if (
      currentWordCount + sentenceWordCount > chunkSize &&
      currentChunk.length > 0
    ) {
      // Emit the current chunk
      const chunkText = currentChunk.join(" ").trim();
      if (chunkText.length > 100) {
        chunks.push(chunkText);
      }

      // Overlap: keep the last few sentences for context continuity
      const overlapSentences = currentChunk.slice(-Math.ceil(overlap / 20));
      currentChunk = overlapSentences;
      currentWordCount = overlapSentences.join(" ").split(/\s+/).length;
    }

    currentChunk.push(sentence);
    currentWordCount += sentenceWordCount;
  }

  // Emit remaining chunk
  if (currentChunk.length > 0) {
    const remaining = currentChunk.join(" ").trim();
    if (remaining.length > 100) {
      chunks.push(remaining);
    }
  }

  return chunks;
}

// --- Core Ingestion Function ---
async function ingestDocument(config: IngestConfig): Promise<void> {
  const { style_id, style_name, description, file } = config;

  if (!file) {
    throw new Error("file path is required");
  }

  const resolvedPath = resolve(file);
  if (!existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const ext = extname(resolvedPath).toLowerCase();
  const supported = [".pdf", ".docx", ".txt", ".md", ".markdown"];
  if (!supported.includes(ext)) {
    throw new Error(
      `Unsupported file extension "${ext}". Supported formats: ${supported.join(", ")}`
    );
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📄 Processing: ${resolvedPath}`);
  console.log(`🏷️  Style ID: ${style_id}`);
  console.log(`📚 Style Name: ${style_name}`);
  console.log(`${"=".repeat(60)}\n`);

  const documentId = uuidv4();

  // Step 1: Extract text
  console.log("Step 1/4: Extracting text...");
  const rawText = await extractTextFromFile(resolvedPath);
  console.log(`  ✓ Extracted ${rawText.length} characters`);

  // Step 2: Chunk text
  console.log("Step 2/4: Chunking text...");
  const chunks = chunkText(rawText);
  console.log(`  ✓ Created ${chunks.length} chunks`);

  if (chunks.length === 0) {
    throw new Error("No text chunks generated — document may be empty or unreadable");
  }

  // Step 3: Generate embeddings and build Pinecone vectors
  console.log("Step 3/4: Generating embeddings with Gemini...");
  const indexDimension = await getIndexDimension();
  if (indexDimension) {
    console.log(`  ℹ️  Pinecone index dimension detected: ${indexDimension}`);
  }
  const vectors: Array<{
    id: string;
    values: number[];
    metadata: ChunkMetadata;
  }> = [];

  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(
      `  Embedding chunk ${i + 1}/${chunks.length}...\r`
    );

    const embedding = await generateEmbedding(chunks[i], indexDimension);

    /**
     * CRITICAL: Every embedded chunk must include metadata tagging its style.
     * This enables strict Pinecone metadata filtering by style_id.
     */
    vectors.push({
      id: `${documentId}-chunk-${i}`,
      values: embedding,
      metadata: {
        style_id,          // ← CRITICAL: style filter tag
        document_id: documentId,
        document_name: file,
        chunk_index: i,
        total_chunks: chunks.length,
        text: chunks[i],   // Store text for retrieval without re-fetching
      },
    });
  }

  console.log(`\n  ✓ Generated ${vectors.length} embeddings`);

  // Step 4: Upsert to Pinecone in batches
  console.log("Step 4/4: Upserting to Pinecone...");
  const BATCH_SIZE = 100;
  const batches = Math.ceil(vectors.length / BATCH_SIZE);

  for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
    const batch = vectors.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    await upsertChunks(batch);
    console.log(
      `  ✓ Upserted batch ${batchNum}/${batches} (${batch.length} vectors)`
    );
  }

  // Register the style in Appwrite if not already done
  try {
    await createStyle(style_name, style_id, description ?? "");
    console.log(`  ✓ Registered style "${style_name}" (${style_id}) in Appwrite`);
  } catch {
    console.log(`  ℹ️  Style "${style_id}" already registered in Appwrite`);
  }

  console.log(`\n✅ Successfully ingested "${file}" as style "${style_id}"`);
  console.log(`   Document ID: ${documentId}`);
  console.log(`   Chunks upserted: ${vectors.length}`);
}

// --- Verify Pinecone Index Exists ---
async function verifyPineconeIndex(): Promise<void> {
  console.log("Verifying Pinecone connection...");
  const index = getPineconeIndex();
  const stats = await index.describeIndexStats();
  console.log(
    `✓ Pinecone index ready. Total vectors: ${stats.totalRecordCount ?? 0}\n`
  );
}

// --- Main Entry Point ---
async function main(): Promise<void> {
  console.log("\n🚀 ProjectAi — Vector Database Ingestion Script");
  console.log("================================================\n");

  const args = parseArgs();

  await verifyPineconeIndex();

  if (args.config) {
    // Batch mode: process all documents in config file
    const configPath = resolve(args.config);
    if (!existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }

    const configFile: ConfigFile = JSON.parse(
      readFileSync(configPath, "utf-8")
    );

    console.log(
      `📋 Batch mode: Processing ${configFile.documents.length} documents\n`
    );

    for (const docConfig of configFile.documents) {
      await ingestDocument(docConfig);
    }

    console.log(
      `\n🎉 Batch ingestion complete! Processed ${configFile.documents.length} documents.`
    );
  } else {
    // Single file mode
    if (!args.style_id || !args.style_name || !args.file) {
      console.error("❌ Missing required arguments.\n");
      console.error(
        "Usage: npx tsx src/scripts/ingestDocuments.ts --file <path.pdf|.docx|.txt|.md> --style_id <id> --style_name <name> [--description <desc>]"
      );
      console.error(
        "   Or: npx tsx src/scripts/ingestDocuments.ts --config <path>"
      );
      console.error("\nExample ingest-config.json:");
      console.error(
        JSON.stringify(
          {
            documents: [
              {
                file: "./references/harvard_business.pdf",
                style_id: "harvard_business",
                style_name: "Harvard Business School",
                description: "HBS case study format with in-text citations",
              },
              {
                file: "./references/cs_thesis.pdf",
                style_id: "computer_science_thesis",
                style_name: "Computer Science Thesis",
                description: "IEEE-style CS thesis with numbered references",
              },
            ],
          },
          null,
          2
        )
      );
      process.exit(1);
    }

    await ingestDocument({
      file: args.file,
      style_id: args.style_id,
      style_name: args.style_name,
      description: args.description,
    });
  }
}

main().catch((err) => {
  console.error("\n❌ Ingestion failed:", err);
  process.exit(1);
});
