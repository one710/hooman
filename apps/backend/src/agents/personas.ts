import type { PersonaConfig } from "../types.js";
import type { PersonaStore } from "../data/personas-store.js";

export type PersonaConfigListener = (personas: PersonaConfig[]) => void;

export class PersonaEngine {
  private personas: PersonaConfig[] = [];
  private listeners: PersonaConfigListener[] = [];
  private store: PersonaStore;

  constructor(store: PersonaStore) {
    this.store = store;
  }

  /** Load personas from store into cache. Call once at startup. */
  async load(): Promise<void> {
    this.personas = await this.store.getAll();
    this.listeners.forEach((l) => l(this.personas));
  }

  getAll(): PersonaConfig[] {
    return [...this.personas];
  }

  getById(id: string): PersonaConfig | undefined {
    return this.personas.find((p) => p.id === id);
  }

  setPersonas(personas: PersonaConfig[]): void {
    this.personas = personas;
    this.listeners.forEach((l) => l(this.personas));
  }

  async addOrUpdate(persona: PersonaConfig): Promise<void> {
    if (this.store) {
      await this.store.addOrUpdate(persona);
    }
    const idx = this.personas.findIndex((p) => p.id === persona.id);
    if (idx >= 0) this.personas[idx] = persona;
    else this.personas.push(persona);
    this.listeners.forEach((l) => l(this.personas));
  }

  async remove(id: string): Promise<boolean> {
    const ok = await this.store.remove(id);
    if (!ok) return false;
    const before = this.personas.length;
    this.personas = this.personas.filter((p) => p.id !== id);
    if (this.personas.length !== before) {
      this.listeners.forEach((l) => l(this.personas));
      return true;
    }
    return false;
  }

  subscribe(listener: PersonaConfigListener): () => void {
    this.listeners.push(listener);
    listener(this.personas);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}
