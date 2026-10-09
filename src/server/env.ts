import "@tanstack/react-start/server-only";

/**
 * Server configuration. Read from process.env only — never `import.meta.env`,
 * so secrets can't be inlined into a client bundle.
 */

let loaded = false;

/** Loads .env.local / .env for local development. Existing variables always win. */
export function loadServerEnv() {
  if (loaded) return;
  loaded = true;
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      /* file not present — rely on the real environment */
    }
  }
}

export class ServerConfigError extends Error {
  constructor(variable: string) {
    super(`Missing or invalid server configuration: ${variable}`);
    this.name = "ServerConfigError";
  }
}

export interface ServerConfig {
  mongodbUri: string;
  mongodbDbName: string;
  authSecret: string;
}

export function getServerConfig(): ServerConfig {
  loadServerEnv();
  const mongodbUri = process.env.MONGODB_URI?.trim();
  const mongodbDbName = process.env.MONGODB_DB_NAME?.trim() || "kodeproctor";
  const authSecret = process.env.KPROCTOR_AUTH_SECRET?.trim();

  if (!mongodbUri) throw new ServerConfigError("MONGODB_URI");
  if (!authSecret || authSecret.length < 32) throw new ServerConfigError("KPROCTOR_AUTH_SECRET");
  return { mongodbUri, mongodbDbName, authSecret };
}
