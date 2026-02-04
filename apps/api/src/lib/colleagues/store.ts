import { MongoClient, Collection } from "mongodb";
import type { ColleagueConfig } from "../types/index.js";

const COL = "colleagues";

export interface ColleagueStore {
  getAll(): Promise<ColleagueConfig[]>;
  getById(id: string): Promise<ColleagueConfig | null>;
  addOrUpdate(colleague: ColleagueConfig): Promise<void>;
  remove(id: string): Promise<boolean>;
}

let client: MongoClient | null = null;
let coll: Collection<ColleagueConfig> | null = null;

export async function initColleagueStore(uri: string): Promise<ColleagueStore> {
  client = new MongoClient(uri);
  await client.connect();
  const db = client.db("hooman");
  coll = db.collection<ColleagueConfig>(COL);
  await coll.createIndex({ id: 1 }, { unique: true });

  return {
    async getAll(): Promise<ColleagueConfig[]> {
      const list = await coll!.find({}).toArray();
      return list.map((doc) => ({
        id: doc.id,
        description: doc.description ?? "",
        responsibilities: doc.responsibilities ?? "",
        allowed_capabilities: Array.isArray(doc.allowed_capabilities)
          ? doc.allowed_capabilities
          : [],
        autonomy: doc.autonomy ?? { default: "ask_first" },
        memory: doc.memory ?? { scope: "role" },
        reporting: doc.reporting ?? { on: ["task_complete", "uncertainty"] },
      }));
    },

    async getById(id: string): Promise<ColleagueConfig | null> {
      const doc = await coll!.findOne({ id });
      if (!doc) return null;
      return {
        id: doc.id,
        description: doc.description ?? "",
        responsibilities: doc.responsibilities ?? "",
        allowed_capabilities: Array.isArray(doc.allowed_capabilities)
          ? doc.allowed_capabilities
          : [],
        autonomy: doc.autonomy ?? { default: "ask_first" },
        memory: doc.memory ?? { scope: "role" },
        reporting: doc.reporting ?? { on: ["task_complete", "uncertainty"] },
      };
    },

    async addOrUpdate(colleague: ColleagueConfig): Promise<void> {
      await coll!.updateOne(
        { id: colleague.id },
        { $set: colleague },
        { upsert: true },
      );
    },

    async remove(id: string): Promise<boolean> {
      const result = await coll!.deleteOne({ id });
      return (result.deletedCount ?? 0) > 0;
    },
  };
}
