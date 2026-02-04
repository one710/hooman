import type { ColleagueConfig } from "../types/index.js";
import type { ColleagueStore } from "./store.js";

export type ColleagueConfigListener = (colleagues: ColleagueConfig[]) => void;

export class ColleagueEngine {
  private colleagues: ColleagueConfig[] = [];
  private listeners: ColleagueConfigListener[] = [];
  private store: ColleagueStore;

  constructor(store: ColleagueStore) {
    this.store = store;
  }

  /** Load colleagues from store into cache. Call once at startup. */
  async load(): Promise<void> {
    this.colleagues = await this.store.getAll();
    this.listeners.forEach((l) => l(this.colleagues));
  }

  getAll(): ColleagueConfig[] {
    return [...this.colleagues];
  }

  getById(id: string): ColleagueConfig | undefined {
    return this.colleagues.find((p) => p.id === id);
  }

  setColleagues(colleagues: ColleagueConfig[]): void {
    this.colleagues = colleagues;
    this.listeners.forEach((l) => l(this.colleagues));
  }

  async addOrUpdate(colleague: ColleagueConfig): Promise<void> {
    if (this.store) {
      await this.store.addOrUpdate(colleague);
    }
    const idx = this.colleagues.findIndex((p) => p.id === colleague.id);
    if (idx >= 0) this.colleagues[idx] = colleague;
    else this.colleagues.push(colleague);
    this.listeners.forEach((l) => l(this.colleagues));
  }

  async remove(id: string): Promise<boolean> {
    const ok = await this.store.remove(id);
    if (!ok) return false;
    const before = this.colleagues.length;
    this.colleagues = this.colleagues.filter((p) => p.id !== id);
    if (this.colleagues.length !== before) {
      this.listeners.forEach((l) => l(this.colleagues));
      return true;
    }
    return false;
  }

  subscribe(listener: ColleagueConfigListener): () => void {
    this.listeners.push(listener);
    listener(this.colleagues);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}
