import type { Express, Request, Response } from "express";
import type { AppContext } from "./helpers.js";
import { getParam } from "./helpers.js";
import type { PersonaConfig } from "../types.js";

export function registerPersonaRoutes(app: Express, ctx: AppContext): void {
  const { personaEngine } = ctx;

  app.get("/api/personas", (_req: Request, res: Response) => {
    res.json({ personas: personaEngine.getAll() });
  });

  app.post(
    "/api/personas",
    async (req: Request, res: Response): Promise<void> => {
      const body = req.body as PersonaConfig;
      if (!body?.id) {
        res.status(400).json({ error: "Missing persona id." });
        return;
      }
      await personaEngine.addOrUpdate(body);
      res.status(201).json({ persona: personaEngine.getById(body.id) });
    },
  );

  app.patch(
    "/api/personas/:id",
    async (req: Request, res: Response): Promise<void> => {
      const id = getParam(req, "id");
      const existing = personaEngine.getById(id);
      if (!existing) {
        res.status(404).json({ error: "Persona not found." });
        return;
      }
      await personaEngine.addOrUpdate({
        ...existing,
        ...req.body,
        id,
      });
      res.json({ persona: personaEngine.getById(id) });
    },
  );

  app.delete(
    "/api/personas/:id",
    async (req: Request, res: Response): Promise<void> => {
      const ok = await personaEngine.remove(getParam(req, "id"));
      if (!ok) {
        res.status(404).json({ error: "Persona not found." });
        return;
      }
      res.status(204).send();
    },
  );
}
