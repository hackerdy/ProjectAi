import { Client, Databases, Storage, ID, Query } from "appwrite";

const client = new Client();

if (!process.env.APPWRITE_ENDPOINT || !process.env.APPWRITE_PROJECT_ID) {
  throw new Error(
    "APPWRITE_ENDPOINT and APPWRITE_PROJECT_ID environment variables are required"
  );
}

client
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID);

export const databases = new Databases(client);
export const storage = new Storage(client);

export const DATABASE_ID =
  process.env.APPWRITE_DATABASE_ID ?? "projectai-db";
export const JOBS_COLLECTION = process.env.APPWRITE_JOBS_COLLECTION_ID ?? "jobs";
export const STYLES_COLLECTION =
  process.env.APPWRITE_STYLES_COLLECTION_ID ?? "styles";
export const BUCKET_ID = process.env.APPWRITE_BUCKET_ID ?? "references";

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

export async function createJob(
  topic: string,
  styleId: string
): Promise<JobDocument> {
  const doc = await databases.createDocument(
    DATABASE_ID,
    JOBS_COLLECTION,
    ID.unique(),
    {
      topic,
      style_id: styleId,
      status: "queued",
      current_agent: "planner",
      outline: "",
      research: "",
      draft: "",
      final_document: "",
      error_message: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  );
  return doc as unknown as JobDocument;
}

export async function updateJob(
  jobId: string,
  updates: Partial<Omit<JobDocument, "$id">>
): Promise<JobDocument> {
  const doc = await databases.updateDocument(DATABASE_ID, JOBS_COLLECTION, jobId, {
    ...updates,
    updated_at: new Date().toISOString(),
  });
  return doc as unknown as JobDocument;
}

export async function getJob(jobId: string): Promise<JobDocument> {
  const doc = await databases.getDocument(
    DATABASE_ID,
    JOBS_COLLECTION,
    jobId
  );
  return doc as unknown as JobDocument;
}

export async function listStyles(): Promise<StyleDocument[]> {
  const result = await databases.listDocuments(
    DATABASE_ID,
    STYLES_COLLECTION,
    [Query.limit(100)]
  );
  return result.documents as unknown as StyleDocument[];
}

export async function createStyle(
  name: string,
  styleId: string,
  description: string
): Promise<StyleDocument> {
  const doc = await databases.createDocument(
    DATABASE_ID,
    STYLES_COLLECTION,
    ID.unique(),
    {
      name,
      style_id: styleId,
      description,
      created_at: new Date().toISOString(),
    }
  );
  return doc as unknown as StyleDocument;
}

export { client, ID, Query };
