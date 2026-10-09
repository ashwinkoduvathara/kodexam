/**
 * DEVELOPMENT ONLY — runs a local single-node replica set for KProctor.
 *
 *   npm run db:replset
 *
 * Data lives in ./.data/mongodb-rs (git-ignored). Point the app at it with:
 *   MONGODB_URI=mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=true
 *
 * Production must use a managed replica set (e.g. MongoDB Atlas) with
 * authentication, TLS and encrypted backups.
 */
import { resolve } from "node:path";
import { startReplicaSet } from "./lib/replica-set";

const port = Number(process.env.KPROCTOR_DEV_REPLSET_PORT ?? 27018);
const rs = await startReplicaSet({ port, dbPath: resolve(".data/mongodb-rs"), quiet: true });
console.log(`Replica set ready: ${rs.uri}\nPress Ctrl+C to stop.`);

const shutdown = async () => {
  await rs.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
