import { Router, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import mammoth from "mammoth";
import {
  storage as appwriteStorage,
  BUCKET_ID,
  createStyle,
  ID,
  listStyles,
} from "../lib/appwrite.js";
import { generateEmbedding } from "../lib/gemini.js";
import { upsertChunks, ChunkMetadata, getIndexDimension } from "../lib/pinecone.js";
import { v4 as uuidv4 } from "uuid";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_MIME  = "application/msword";

const router = Router();

// Use memory storage for multer to get Buffer in req.file
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "text/plain",
      "text/markdown",
      DOCX_MIME,
      DOC_MIME,
    ];
    if (allowed.includes(file.mimetype)) {
      if (file.mimetype === DOC_MIME) {
        cb(new Error("Legacy .doc format is not supported. Please convert your file to .docx and re-upload."));
      } else {
        cb(null, true);
      }
    } else {
      cb(new Error("Only PDF, DOCX, TXT, and Markdown files are allowed"));
    }
  },
});

const UploadStyleSchema = z.object({
  style_id: z.string().min(1).regex(/^[a-z0-9_]+$/, "style_id must be lowercase alphanumeric with underscores"),
  style_name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

async function runUploadMiddleware(req: Request, res: Response): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    upload.single("document")(req, res, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function chunkText(text: string, chunkSize = 800, overlap = 100): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];

  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(" ");
    if (chunk.trim().length > 50) {
      chunks.push(chunk.trim());
    }
  }

  return chunks;
}

async function extractText(buffer: Buffer, mimetype: string): Promise<string> {
  if (mimetype === "application/pdf") {
    // Dynamic import for pdf-parse to avoid ES module issues
    const pdfParse = await import("pdf-parse").then((m) => m.default ?? m);
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (mimetype === DOCX_MIME) {
    const result = await mammoth.extractRawText({ buffer });
    if (result.messages.length > 0) {
      result.messages.forEach((msg) => {
        if (msg.type === "warning") {
          console.warn(`[Admin] mammoth warning: ${msg.message}`);
        }
      });
    }
    return result.value;
  }

  // Plain text or markdown
  return buffer.toString("utf-8");
}

// POST /api/admin/upload — Upload a reference document and ingest it
router.post(
  "/upload",
  async (req: Request, res: Response) => {
    try {
      await runUploadMiddleware(req, res);
    } catch (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ error: "File is too large. Maximum size is 50MB." });
        }
        return res.status(400).json({ error: err.message });
      }

      const message = err instanceof Error ? err.message : "Invalid upload request";
      return res.status(400).json({ error: message });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const parsed = UploadStyleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
    }

    const { style_id, style_name, description } = parsed.data;
    const documentId = uuidv4();
    const documentName = req.file.originalname;

    try {
      // 1. Upload to Appwrite Storage
      console.log(`[Admin] Uploading ${documentName} to Appwrite...`);
      const fileBlob = new Blob([req.file.buffer], { type: req.file.mimetype });
      await appwriteStorage.createFile(
        BUCKET_ID,
        ID.unique(),
        new File([fileBlob], documentName, { type: req.file.mimetype })
      );

      // 2. Extract text
      console.log(`[Admin] Extracting text from ${documentName}...`);
      const rawText = await extractText(req.file.buffer, req.file.mimetype);

      // 3. Chunk text
      const chunks = chunkText(rawText);
      console.log(`[Admin] Created ${chunks.length} chunks from ${documentName}`);

      // 4. Generate embeddings and upsert to Pinecone
      console.log(`[Admin] Generating embeddings and upserting to Pinecone...`);
      const indexDimension = await getIndexDimension();
      if (indexDimension) {
        console.log(`[Admin] Using embedding output dimensionality: ${indexDimension}`);
      }

      const vectors: Array<{
        id: string;
        values: number[];
        metadata: ChunkMetadata;
      }> = [];

      for (let i = 0; i < chunks.length; i++) {
        const embedding = await generateEmbedding(chunks[i], indexDimension);
        vectors.push({
          id: `${documentId}-chunk-${i}`,
          values: embedding,
          metadata: {
            style_id,
            document_id: documentId,
            document_name: documentName,
            chunk_index: i,
            total_chunks: chunks.length,
            text: chunks[i],
          },
        });
      }

      // Upsert in batches of 100
      const BATCH_SIZE = 100;
      for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
        const batch = vectors.slice(i, i + BATCH_SIZE);
        await upsertChunks(batch);
        console.log(
          `[Admin] Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(vectors.length / BATCH_SIZE)}`
        );
      }

      // 5. Register style in Appwrite if not already existing
      try {
        await createStyle(style_name, style_id, description ?? "");
        console.log(`[Admin] Registered style: ${style_id}`);
      } catch {
        // Style may already exist — that's fine
        console.log(`[Admin] Style ${style_id} already registered`);
      }

      return res.json({
        success: true,
        document_id: documentId,
        document_name: documentName,
        style_id,
        chunks_processed: chunks.length,
        message: `Successfully ingested ${chunks.length} chunks with style_id="${style_id}"`,
      });
    } catch (err) {
      console.error("[Admin] Upload failed:", err);
      return res.status(500).json({
        error: "Failed to process document",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  }
);

// GET /api/admin/styles — List all registered styles
router.get("/styles", async (_req: Request, res: Response) => {
  try {
    const styles = await listStyles();
    return res.json({ styles });
  } catch (err) {
    console.error("[Admin] Failed to list styles:", err);
    return res.status(500).json({ error: "Failed to list styles" });
  }
});

export default router;
