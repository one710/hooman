-- SQLite: recreate Schedule so execute_at can be nullable (either execute_at or cron, no placeholder)
CREATE TABLE "Schedule2" (
    "id" TEXT NOT NULL,
    "execute_at" TEXT,
    "intent" TEXT NOT NULL,
    "context" TEXT NOT NULL DEFAULT '{}',
    "cron" TEXT,
    CONSTRAINT "Schedule2_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Schedule2" ("id", "execute_at", "intent", "context", "cron")
SELECT "id", "execute_at", "intent", "context", "cron" FROM "Schedule";

DROP TABLE "Schedule";

ALTER TABLE "Schedule2" RENAME TO "Schedule";
