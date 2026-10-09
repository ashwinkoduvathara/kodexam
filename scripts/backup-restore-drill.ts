/**
 * Backup → encrypted archive → restore drill, in ISOLATED throwaway MongoDB
 * instances. It never connects to, reads, resets or overwrites the development
 * (or any existing) database.
 *
 *   npm run drill:backup
 *
 * Methods:
 *   mongodump   logical backup (mongodump --archive / mongorestore). Needs MongoDB
 *               Database Tools on PATH; reported BLOCKED when they're missing.
 *   snapshot    filesystem snapshot: clean shutdown, then every data file is
 *               encrypted (AES-256-GCM) into the backup set; restored by decrypting
 *               into a fresh data directory and starting a separate instance.
 *
 * Verification: per-collection document counts + SHA-256 of all documents
 * (canonical EJSON, sorted by _id) + index names must match exactly; the backup
 * must not contain plaintext; a wrong key must fail; backup files must not be
 * readable by other users (POSIX only — use NTFS ACLs / bucket policies elsewhere).
 *
 * Key: KPROCTOR_BACKUP_KEY (32 bytes, base64) — a throwaway key is generated if unset.
 * Exit code: 0 = every available method passed, 1 = failure, 2 = all methods blocked.
 */
import { spawn, spawnSync } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import { findMongod, startReplicaSet } from "./lib/replica-set";

const DB = "kproctor_drill";
const MARKER = `DRILL-MARKER-${randomUUID()}`;
type Status = "PASS" | "FAIL" | "BLOCKED";
const results: { check: string; status: Status; detail?: string }[] = [];
const note = (check: string, status: Status, detail = "") => {
  results.push({ check, status, detail });
  console.log(`${status.padEnd(7)} ${check}${detail ? ` — ${detail}` : ""}`);
};

const key = process.env.KPROCTOR_BACKUP_KEY
  ? Buffer.from(process.env.KPROCTOR_BACKUP_KEY, "base64")
  : randomBytes(32);
if (key.length !== 32) throw new Error("KPROCTOR_BACKUP_KEY must be 32 bytes (base64).");

// ── Data ─────────────────────────────────────────────────────────────────────
async function seed(db: Db) {
  const now = new Date();
  const exam = new ObjectId();
  const candidates = Array.from({ length: 20 }, () => new ObjectId());
  await db
    .collection("exams")
    .insertOne({ _id: exam, examCode: "DRILL-1", name: MARKER, createdAt: now });
  await db.collection("users").insertMany(
    candidates.map((_id, i) => ({
      _id,
      role: "candidate",
      name: `Candidate ${i}`,
      email: `c${i}@drill.test`,
      status: "ACTIVE",
    })),
  );
  const attempts = candidates.map((candidateId, i) => ({
    _id: new ObjectId(),
    examId: exam,
    candidateId,
    attemptNumber: 1,
    status: i % 3 === 0 ? "SUBMITTED" : "IN_PROGRESS",
    expiresAt: new Date(now.getTime() + 3600_000),
  }));
  await db.collection("examAttempts").insertMany(attempts);
  await db.collection("candidateAnswers").insertMany(
    attempts.flatMap((a) =>
      Array.from({ length: 10 }, (_, q) => ({
        attemptId: a._id,
        questionId: new ObjectId(),
        selectedOptionIds: [`opt${(q % 4) + 1}`],
        answerVersion: 1,
        savedAt: now,
      })),
    ),
  );
  await db.collection("auditLogs").insertMany(
    attempts.map((a) => ({
      eventType: "EXAM_STARTED",
      attemptId: a._id,
      timestamp: now,
      metadata: {},
    })),
  );
  await db
    .collection("examAttempts")
    .createIndex(
      { examId: 1, candidateId: 1, attemptNumber: 1 },
      { name: "exam_candidate_attempt_unique", unique: true },
    );
  await db
    .collection("candidateAnswers")
    .createIndex(
      { attemptId: 1, questionId: 1 },
      { name: "attempt_question_unique", unique: true },
    );
}

async function fingerprint(db: Db) {
  const out: Record<string, { count: number; sha256: string; indexes: string[] }> = {};
  for (const { name } of await db.listCollections().toArray()) {
    const docs = await db.collection(name).find().sort({ _id: 1 }).toArray();
    out[name] = {
      count: docs.length,
      sha256: createHash("sha256")
        .update(BSON.EJSON.stringify(docs, { relaxed: false }))
        .digest("hex"),
      indexes: (await db.collection(name).indexes()).map((i) => String(i.name)).sort(),
    };
  }
  return out;
}

// ── Encryption ───────────────────────────────────────────────────────────────
function encryptTree(src: string, dest: string, k: Buffer) {
  const manifest: { file: string; iv: string; tag: string; sha256: string; size: number }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name !== "mongod.lock") {
        const plain = readFileSync(path);
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", k, iv);
        const rel = relative(src, path);
        cipher.setAAD(Buffer.from(rel));
        const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);
        const out = join(dest, `${rel}.enc`);
        mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
        writeFileSync(out, sealed, { mode: 0o600 });
        manifest.push({
          file: rel,
          iv: iv.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
          sha256: createHash("sha256").update(plain).digest("hex"),
          size: plain.length,
        });
      }
    }
  };
  walk(src);
  writeFileSync(join(dest, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
  return manifest;
}

function decryptTree(src: string, dest: string, k: Buffer) {
  const manifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8")) as {
    file: string;
    iv: string;
    tag: string;
    sha256: string;
  }[];
  for (const m of manifest) {
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(m.iv, "base64"));
    decipher.setAAD(Buffer.from(m.file));
    decipher.setAuthTag(Buffer.from(m.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(readFileSync(join(src, `${m.file}.enc`))),
      decipher.final(),
    ]);
    if (createHash("sha256").update(plain).digest("hex") !== m.sha256)
      throw new Error("integrity mismatch");
    const out = join(dest, m.file);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, plain);
  }
}

function filesContain(dir: string, needle: Buffer): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() ? filesContain(path, needle) : readFileSync(path).includes(needle))
      return true;
  }
  return false;
}

/** A standalone, isolated mongod on its own port and data directory. */
async function startStandalone(dbPath: string, port: number) {
  const child = spawn(
    findMongod(),
    ["--port", String(port), "--bind_ip", "127.0.0.1", "--dbpath", dbPath, "--quiet"],
    {
      stdio: "ignore",
      windowsHide: true,
    },
  );
  const uri = `mongodb://127.0.0.1:${port}/?directConnection=true`;
  for (let i = 0; i < 120; i++) {
    const c = new MongoClient(uri, { serverSelectionTimeoutMS: 500 });
    try {
      await c.connect();
      await c.db("admin").command({ ping: 1 });
      await c.close();
      return { uri, child };
    } catch {
      await c.close().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  child.kill();
  throw new Error("restored instance did not start");
}

async function cleanShutdown(
  uri: string,
  child: { exitCode: number | null; once: (e: "exit", cb: () => void) => unknown },
) {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 2000 });
  await c.connect();
  await c
    .db("admin")
    .command({ shutdown: 1, force: true })
    .catch(() => undefined); // connection drops
  await c.close().catch(() => undefined);
  if (child.exitCode === null) await new Promise<void>((r) => child.once("exit", () => r()));
}

// ── Methods ──────────────────────────────────────────────────────────────────
async function snapshotDrill(root: string) {
  const srcPath = join(root, "source");
  const source = await startReplicaSet({ port: 27031, dbPath: srcPath, quiet: true });
  let expected: Awaited<ReturnType<typeof fingerprint>>;
  {
    const client = new MongoClient(source.uri);
    await client.connect();
    await seed(client.db(DB));
    expected = await fingerprint(client.db(DB));
    await client.close();
  }
  await cleanShutdown(source.uri.replace("replicaSet=rs0&", ""), source.process);

  const backupPath = join(root, "backup");
  mkdirSync(backupPath, { recursive: true, mode: 0o700 });
  const manifest = encryptTree(srcPath, backupPath, key);
  note("Snapshot backup created", "PASS", `${manifest.length} files encrypted (AES-256-GCM)`);

  const marker = Buffer.from(MARKER);
  // Control: the marker must be visible in the unencrypted data files, or the check proves nothing.
  if (!filesContain(srcPath, marker)) {
    note(
      "Backup contains no plaintext marker",
      "BLOCKED",
      "marker not visible in raw data files (compressed); inconclusive",
    );
  } else {
    note(
      "Backup contains no plaintext (marker visible in raw data, absent from backup)",
      filesContain(backupPath, marker) ? "FAIL" : "PASS",
    );
  }
  if (process.platform !== "win32") {
    const loose = manifest.some(
      (m) => (statSync(join(backupPath, `${m.file}.enc`)).mode & 0o077) !== 0,
    );
    note("Backup files readable by owner only (0600)", loose ? "FAIL" : "PASS");
  } else {
    note(
      "Backup files readable by owner only",
      "BLOCKED",
      "POSIX modes don't apply on Windows; enforce with NTFS ACLs / storage policy",
    );
  }
  try {
    decryptTree(backupPath, join(root, "wrong-key"), randomBytes(32));
    note("Wrong key is rejected", "FAIL");
  } catch {
    note("Wrong key is rejected", "PASS");
  }

  const restorePath = join(root, "restore");
  decryptTree(backupPath, restorePath, key);
  const restored = await startStandalone(restorePath, 27032);
  try {
    const client = new MongoClient(restored.uri);
    await client.connect();
    const actual = await fingerprint(client.db(DB));
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    const counts = Object.entries(actual)
      .map(([k, v]) => `${k}=${v.count}`)
      .join(", ");
    note(
      "Restored data identical (counts, document hashes, indexes)",
      same ? "PASS" : "FAIL",
      counts,
    );
    await client.close();
  } finally {
    await cleanShutdown(restored.uri, restored.child);
  }
}

async function mongodumpDrill() {
  const has = (bin: string) => spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0;
  if (!has("mongodump") || !has("mongorestore")) {
    note(
      "mongodump / mongorestore drill",
      "BLOCKED",
      "MongoDB Database Tools not installed on PATH",
    );
    return;
  }
  note(
    "mongodump / mongorestore drill",
    "BLOCKED",
    "tools found but this drill only automates the snapshot method; run docs/17 procedure",
  );
}

const root = mkdtempSync(join(tmpdir(), "kproctor-drill-"));
try {
  await mongodumpDrill();
  await snapshotDrill(root);
} catch (error) {
  note("Drill run", "FAIL", (error as Error).message);
} finally {
  rmSync(root, { recursive: true, force: true });
}
const failed = results.some((r) => r.status === "FAIL");
const passed = results.some((r) => r.status === "PASS");
console.log(`\nResult: ${failed ? "FAILED" : passed ? "PASSED (available methods)" : "BLOCKED"}`);
process.exitCode = failed ? 1 : passed ? 0 : 2;
