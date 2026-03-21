import { Client, Databases, Storage, ID, Permission, Query, Role } from "node-appwrite";
import { randomUUID } from "node:crypto";

const client = new Client();

if (!process.env.APPWRITE_ENDPOINT || !process.env.APPWRITE_PROJECT_ID) {
  throw new Error(
    "APPWRITE_ENDPOINT and APPWRITE_PROJECT_ID environment variables are required"
  );
}

client
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID);

if (process.env.APPWRITE_API_KEY) {
  client.setKey(process.env.APPWRITE_API_KEY);
} else {
  console.warn(
    "[Appwrite] APPWRITE_API_KEY is not set. Server-side write operations may fail with 401 errors."
  );
}

export const databases = new Databases(client);
export const storage = new Storage(client);

export const DATABASE_ID =
  process.env.APPWRITE_DATABASE_ID ?? "projectai-db";
export const JOBS_COLLECTION = process.env.APPWRITE_JOBS_COLLECTION_ID ?? "jobs";
export const STYLES_COLLECTION =
  process.env.APPWRITE_STYLES_COLLECTION_ID ?? "styles";
export const BUCKET_ID = process.env.APPWRITE_BUCKET_ID ?? "references";

export interface AppwriteLikeError {
  code?: number;
  type?: string;
  message?: string;
  response?: {
    code?: number;
    type?: string;
    message?: string;
  };
}

export function getAppwriteErrorInfo(error: unknown): {
  code?: number;
  type?: string;
  message: string;
} {
  if (typeof error === "object" && error !== null) {
    const appwriteErr = error as AppwriteLikeError;
    return {
      code: appwriteErr.code ?? appwriteErr.response?.code,
      type: appwriteErr.type ?? appwriteErr.response?.type,
      message:
        appwriteErr.message ?? appwriteErr.response?.message ?? "Unknown Appwrite error",
    };
  }

  return {
    message: error instanceof Error ? error.message : String(error),
  };
}

function getDefaultDocumentPermissions(): string[] {
  const fromEnv = process.env.APPWRITE_DOCUMENT_PERMISSIONS;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  return [
    Permission.read(Role.any()),
    Permission.update(Role.any()),
    Permission.delete(Role.any()),
  ];
}

export type JobStatus =
  | "queued"
  | "planning"
  | "researching"
  | "writing"
  | "reviewing"
  | "completed"
  | "failed";

export interface JobDocument {
  $id: string;
  topic: string;
  style_id: string;
  status: JobStatus;
  progress_percent: number;
  current_agent: string;
  outline: string;
  research: string;
  draft: string;
  final_document: string;
  error_message: string;
  created_at: string;
  updated_at: string;
}

export interface StyleDocument {
  $id: string;
  name: string;
  style_id: string;
  description: string;
  created_at: string;
}

interface StringAttributeSpec {
  key: string;
  size: number;
  required: boolean;
  default?: string;
}

const JOB_ATTRIBUTE_SPECS: StringAttributeSpec[] = [
  { key: "topic", size: 5000, required: false, default: "" },
  { key: "style_id", size: 120, required: false, default: "" },
  { key: "status", size: 40, required: false, default: "queued" },
  { key: "progress_percent", size: 4, required: false, default: "0" },
  { key: "current_agent", size: 80, required: false, default: "planner" },
  { key: "outline", size: 100000, required: false, default: "" },
  { key: "research", size: 1000000, required: false, default: "" },
  { key: "draft", size: 1000000, required: false, default: "" },
  { key: "final_document", size: 1000000, required: false, default: "" },
  { key: "error_message", size: 10000, required: false, default: "" },
  { key: "created_at", size: 64, required: false, default: "" },
  { key: "updated_at", size: 64, required: false, default: "" },
];

const STYLE_ATTRIBUTE_SPECS: StringAttributeSpec[] = [
  { key: "name", size: 200, required: false, default: "" },
  { key: "style_id", size: 120, required: false, default: "" },
  { key: "description", size: 5000, required: false, default: "" },
  { key: "created_at", size: 64, required: false, default: "" },
];

const inMemoryJobs = new Map<string, JobDocument>();
let hasLoggedJobsFallback = false;
let schemaInitPromise: Promise<void> | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureCollectionExists(collectionId: string, name: string): Promise<void> {
  const db = databases as unknown as any;

  try {
    await db.getCollection(DATABASE_ID, collectionId);
    return;
  } catch (error) {
    const appwriteErr = getAppwriteErrorInfo(error);
    if (appwriteErr.code !== 404 && appwriteErr.type !== "collection_not_found") {
      throw error;
    }
  }

  await db.createCollection(
    DATABASE_ID,
    collectionId,
    name,
    getDefaultDocumentPermissions()
  );
  console.log(`[Appwrite] Created collection '${collectionId}'.`);
}

async function listAttributeKeys(collectionId: string): Promise<Set<string>> {
  const db = databases as unknown as any;
  const result = await db.listAttributes(DATABASE_ID, collectionId);
  const keys = new Set<string>();

  for (const attr of result.attributes ?? []) {
    if (typeof attr?.key === "string") {
      keys.add(attr.key);
    }
  }

  return keys;
}

async function ensureStringAttributes(
  collectionId: string,
  specs: StringAttributeSpec[]
): Promise<void> {
  const db = databases as unknown as any;
  let existing = await listAttributeKeys(collectionId);

  for (const spec of specs) {
    if (existing.has(spec.key)) {
      continue;
    }

    try {
      await db.createStringAttribute(
        DATABASE_ID,
        collectionId,
        spec.key,
        spec.size,
        spec.required,
        spec.default ?? "",
        false
      );
      console.log(`[Appwrite] Added attribute '${spec.key}' to '${collectionId}'.`);
    } catch (error) {
      const appwriteErr = getAppwriteErrorInfo(error);
      const msg = appwriteErr.message.toLowerCase();
      if (appwriteErr.code === 409 || msg.includes("already exists")) {
        // Another process may have created it concurrently.
      } else {
        throw error;
      }
    }
  }

  // Attributes may be created asynchronously in Appwrite; poll briefly.
  for (let i = 0; i < 10; i++) {
    existing = await listAttributeKeys(collectionId);
    const missing = specs.filter((spec) => !existing.has(spec.key));
    if (missing.length === 0) {
      return;
    }
    await delay(500);
  }
}

async function ensureCollectionSchema(
  collectionId: string,
  name: string,
  specs: StringAttributeSpec[]
): Promise<void> {
  await ensureCollectionExists(collectionId, name);
  await ensureStringAttributes(collectionId, specs);
}

export async function initializeAppwriteSchema(): Promise<void> {
  if (schemaInitPromise) {
    return schemaInitPromise;
  }

  schemaInitPromise = (async () => {
    if (!process.env.APPWRITE_API_KEY) {
      return;
    }

    try {
      await ensureCollectionSchema(JOBS_COLLECTION, "Project Jobs", JOB_ATTRIBUTE_SPECS);
      await ensureCollectionSchema(STYLES_COLLECTION, "Style Profiles", STYLE_ATTRIBUTE_SPECS);
    } catch (error) {
      const appwriteErr = getAppwriteErrorInfo(error);
      console.warn(`[Appwrite] Schema initialization skipped: ${appwriteErr.message}`);
    }
  })();

  return schemaInitPromise;
}

function shouldUseJobsFallback(error: unknown): boolean {
  const appwriteErr = getAppwriteErrorInfo(error);
  const message = appwriteErr.message.toLowerCase();

  return (
    appwriteErr.code === 401 ||
    appwriteErr.code === 404 ||
    appwriteErr.type === "user_unauthorized" ||
    appwriteErr.type === "collection_not_found" ||
    appwriteErr.type === "document_invalid_structure" ||
    message.includes("unknown attribute") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("socket")
  );
}

function logJobsFallback(error: unknown): void {
  if (hasLoggedJobsFallback) {
    return;
  }

  const appwriteErr = getAppwriteErrorInfo(error);
  console.warn(
    `[Appwrite] Falling back to in-memory jobs store for this process. Reason: ${appwriteErr.message}`
  );
  hasLoggedJobsFallback = true;
}

export async function createJob(
  topic: string,
  styleId: string
): Promise<JobDocument> {
  const now = new Date().toISOString();
  const fallbackJob: JobDocument = {
    $id: randomUUID(),
    topic,
    style_id: styleId,
    status: "queued",
    progress_percent: 0,
    current_agent: "planner",
    outline: "",
    research: "",
    draft: "",
    final_document: "",
    error_message: "",
    created_at: now,
    updated_at: now,
  };

  try {
    await initializeAppwriteSchema();

    const doc = await databases.createDocument(
      DATABASE_ID,
      JOBS_COLLECTION,
      ID.unique(),
      {
        topic,
        style_id: styleId,
        status: "queued",
        progress_percent: "0",
        current_agent: "planner",
        outline: "",
        research: "",
        draft: "",
        final_document: "",
        error_message: "",
        created_at: now,
        updated_at: now,
      },
      getDefaultDocumentPermissions()
    );
    return mapJobDocument(doc as unknown as Record<string, unknown>);
  } catch (error) {
    if (!shouldUseJobsFallback(error)) {
      throw error;
    }

    // Attempt one schema self-heal + retry before falling back to in-memory.
    try {
      await initializeAppwriteSchema();
      const retryDoc = await databases.createDocument(
        DATABASE_ID,
        JOBS_COLLECTION,
        ID.unique(),
        {
          topic,
          style_id: styleId,
          status: "queued",
          progress_percent: "0",
          current_agent: "planner",
          outline: "",
          research: "",
          draft: "",
          final_document: "",
          error_message: "",
          created_at: now,
          updated_at: now,
        },
        getDefaultDocumentPermissions()
      );
      return mapJobDocument(retryDoc as unknown as Record<string, unknown>);
    } catch {
      logJobsFallback(error);
      inMemoryJobs.set(fallbackJob.$id, fallbackJob);
      return fallbackJob;
    }
  }
}

export async function updateJob(
  jobId: string,
  updates: Partial<Omit<JobDocument, "$id">>
): Promise<JobDocument> {
  const memoryJob = inMemoryJobs.get(jobId);
  if (memoryJob) {
    const updatedJob: JobDocument = {
      ...memoryJob,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    inMemoryJobs.set(jobId, updatedJob);
    return updatedJob;
  }

  try {
    const updatePayload: Record<string, unknown> = {
      ...updates,
      updated_at: new Date().toISOString(),
    };

    if (typeof updates.progress_percent === "number") {
      updatePayload.progress_percent = String(
        Math.max(0, Math.min(100, Math.round(updates.progress_percent)))
      );
    }

    const doc = await databases.updateDocument(
      DATABASE_ID,
      JOBS_COLLECTION,
      jobId,
      updatePayload
    );
    return mapJobDocument(doc as unknown as Record<string, unknown>);
  } catch (error) {
    if (!shouldUseJobsFallback(error)) {
      throw error;
    }

    logJobsFallback(error);
    throw error;
  }
}

export async function getJob(jobId: string): Promise<JobDocument> {
  const memoryJob = inMemoryJobs.get(jobId);
  if (memoryJob) {
    return memoryJob;
  }

  const doc = await databases.getDocument(
    DATABASE_ID,
    JOBS_COLLECTION,
    jobId
  );
  return mapJobDocument(doc as unknown as Record<string, unknown>);
}

export async function listJobs(limit = 50): Promise<JobDocument[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.round(limit)));

  if (inMemoryJobs.size > 0) {
    return [...inMemoryJobs.values()]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, safeLimit);
  }

  await initializeAppwriteSchema();
  const result = await databases.listDocuments(DATABASE_ID, JOBS_COLLECTION, [
    Query.limit(safeLimit),
    Query.orderDesc("created_at"),
  ]);

  return (result.documents as unknown as Record<string, unknown>[]).map(mapJobDocument);
}

function mapJobDocument(doc: Record<string, unknown>): JobDocument {
  return {
    ...(doc as unknown as Omit<JobDocument, "progress_percent">),
    progress_percent: Number(doc.progress_percent ?? 0),
  };
}

export async function listStyles(): Promise<StyleDocument[]> {
  try {
    await initializeAppwriteSchema();

    const result = await databases.listDocuments(
      DATABASE_ID,
      STYLES_COLLECTION,
      [Query.limit(100)]
    );
    return result.documents as unknown as StyleDocument[];
  } catch (error) {
    const appwriteErr = getAppwriteErrorInfo(error);
    if (appwriteErr.type === "collection_not_found" || appwriteErr.code === 404) {
      console.warn(
        `[Appwrite] Styles collection '${STYLES_COLLECTION}' not found. Returning an empty styles list.`
      );
      return [];
    }
    throw error;
  }
}

export async function createStyle(
  name: string,
  styleId: string,
  description: string
): Promise<StyleDocument> {
  await initializeAppwriteSchema();

  const doc = await databases.createDocument(
    DATABASE_ID,
    STYLES_COLLECTION,
    ID.unique(),
    {
      name,
      style_id: styleId,
      description,
      created_at: new Date().toISOString(),
    },
    getDefaultDocumentPermissions()
  );
  return doc as unknown as StyleDocument;
}

export { client, ID, Query };
