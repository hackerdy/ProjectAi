import { Pinecone, type RecordMetadata } from "@pinecone-database/pinecone";

if (!process.env.PINECONE_API_KEY) {
  throw new Error("PINECONE_API_KEY environment variable is required");
}

export const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

export const INDEX_NAME =
  process.env.PINECONE_INDEX_NAME ?? "projectai-knowledge-base";

export function getPineconeIndex() {
  return pinecone.index(INDEX_NAME);
}

export interface ChunkMetadata extends RecordMetadata {
  style_id: string;
  document_id: string;
  document_name: string;
  chunk_index: number;
  total_chunks: number;
  text: string;
}

export async function upsertChunks(
  chunks: Array<{ id: string; values: number[]; metadata: ChunkMetadata }>
): Promise<void> {
  const index = getPineconeIndex();
  await index.upsert(chunks);
}

export async function queryByStyleId(
  embedding: number[],
  styleId: string,
  topK = 10
): Promise<Array<{ id: string; score: number; metadata: ChunkMetadata }>> {
  const index = getPineconeIndex();
  const result = await index.query({
    vector: embedding,
    topK,
    filter: { style_id: { $eq: styleId } },
    includeMetadata: true,
  });

  return (result.matches ?? []).map((m) => ({
    id: m.id,
    score: m.score ?? 0,
    metadata: m.metadata as ChunkMetadata,
  }));
}
