import { MongoClient, Collection } from "mongodb";

const COL = "schedules";

export interface ScheduledTaskDoc {
  id: string;
  execute_at: string;
  intent: string;
  context: Record<string, unknown>;
}

export interface ScheduleStore {
  getAll(): Promise<ScheduledTaskDoc[]>;
  add(task: ScheduledTaskDoc): Promise<void>;
  remove(id: string): Promise<boolean>;
}

interface ScheduleDoc {
  id: string;
  execute_at: string;
  intent: string;
  context: Record<string, unknown>;
}

let client: MongoClient | null = null;
let coll: Collection<ScheduleDoc> | null = null;

export async function initScheduleStore(uri: string): Promise<ScheduleStore> {
  client = new MongoClient(uri);
  await client.connect();
  const db = client.db("hooman");
  coll = db.collection<ScheduleDoc>(COL);
  await coll.createIndex({ id: 1 }, { unique: true });
  await coll.createIndex({ execute_at: 1 });

  return {
    async getAll(): Promise<ScheduledTaskDoc[]> {
      const list = await coll!.find({}).toArray();
      return list.map((doc) => ({
        id: doc.id,
        execute_at: doc.execute_at,
        intent: doc.intent,
        context: doc.context ?? {},
      }));
    },

    async add(task: ScheduledTaskDoc): Promise<void> {
      await coll!.insertOne({
        id: task.id,
        execute_at: task.execute_at,
        intent: task.intent,
        context: task.context ?? {},
      });
    },

    async remove(id: string): Promise<boolean> {
      const result = await coll!.deleteOne({ id });
      return (result.deletedCount ?? 0) > 0;
    },
  };
}
