import { MongoClient, Collection } from "mongodb";
import type {
  MCPConnection,
  MCPConnectionHosted,
  MCPConnectionStreamableHttp,
  MCPConnectionStdio,
} from "../types/index.js";

const COL = "mcp_connections";
const CONNECTION_TYPES = ["hosted", "streamable_http", "stdio"] as const;

type MCPConnectionDoc = MCPConnection & { id: string };

export interface MCPConnectionsStore {
  getAll(): Promise<MCPConnection[]>;
  getById(id: string): Promise<MCPConnection | null>;
  addOrUpdate(conn: MCPConnection): Promise<void>;
  remove(id: string): Promise<boolean>;
}

function toConnection(doc: MCPConnectionDoc): MCPConnection {
  if (doc.type === "hosted") {
    const d = doc as MCPConnectionHosted & { id: string };
    return {
      id: d.id,
      type: "hosted",
      server_label: d.server_label,
      server_url: d.server_url ?? "",
      require_approval: d.require_approval ?? "never",
      streaming: d.streaming,
      created_at: d.created_at,
    };
  }
  if (doc.type === "streamable_http") {
    const d = doc as MCPConnectionStreamableHttp & { id: string };
    return {
      id: d.id,
      type: "streamable_http",
      name: d.name,
      url: d.url,
      headers: d.headers,
      timeout_seconds: d.timeout_seconds,
      cache_tools_list: d.cache_tools_list,
      max_retry_attempts: d.max_retry_attempts,
      created_at: d.created_at,
    };
  }
  const d = doc as MCPConnectionStdio & { id: string };
  return {
    id: d.id,
    type: "stdio",
    name: d.name,
    command: d.command,
    args: Array.isArray(d.args) ? d.args : [],
    created_at: d.created_at,
  };
}

let client: MongoClient | null = null;
let coll: Collection<MCPConnectionDoc> | null = null;

export async function initMCPConnectionsStore(
  uri: string,
): Promise<MCPConnectionsStore> {
  client = new MongoClient(uri);
  await client.connect();
  const db = client.db("hooman");
  coll = db.collection<MCPConnectionDoc>(COL);
  await coll.createIndex({ id: 1 }, { unique: true });

  return {
    async getAll(): Promise<MCPConnection[]> {
      const list = (await coll!
        .find({ type: { $in: CONNECTION_TYPES } })
        .toArray()) as MCPConnectionDoc[];
      return list.map(toConnection);
    },

    async getById(id: string): Promise<MCPConnection | null> {
      const doc = (await coll!.findOne({ id })) as MCPConnectionDoc | null;
      if (!doc) return null;
      return toConnection(doc);
    },

    async addOrUpdate(conn: MCPConnection): Promise<void> {
      const doc = {
        ...conn,
        created_at: conn.created_at ?? new Date().toISOString(),
      };
      await coll!.updateOne({ id: conn.id }, { $set: doc }, { upsert: true });
    },

    async remove(id: string): Promise<boolean> {
      const result = await coll!.deleteOne({ id });
      return (result.deletedCount ?? 0) > 0;
    },
  };
}
