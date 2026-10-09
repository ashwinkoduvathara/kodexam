import "@tanstack/react-start/server-only";
import { MongoServerError, ObjectId, type ClientSession, type Db } from "mongodb";
import { API_ERROR } from "@/types/api";
import { ATTEMPT_STATUS } from "@/types/exam-attempt";
import {
  PROCTORING_EVENTS,
  SUPPORTED_QUESTION_TYPES,
  isProctoringEventType,
  type AnswerState,
  type ExamPaperResponse,
  type PaperQuestion,
  type ProctoringEventItem,
  type ProctoringEventType,
  type ProctoringEventsResponse,
  type RecordEventResponse,
  type SaveAnswerRequest,
} from "@/types/paper";
import {
  AUDIT_EVENT,
  getCollections,
  type CandidateAnswerDoc,
  type ExamAttemptDoc,
  type ProctoringEventDoc,
  type QuestionDoc,
} from "../db/collections";
import { inTransactionIfSupported } from "../db/transactions";
import {
  CANDIDATE_NOTICES,
  evaluateEvent,
  resolveEventPolicy,
  type EventSource,
} from "@/types/proctoring-policy";
import { DomainError } from "../errors";
import { consumeRateLimit } from "../rate-limiter";
import { createAuditLogRepository, type AuditContext } from "../repositories/audit-log-repository";
import { createExamSessionService } from "./exam-session-service";

/** Answer writes (including visits and review toggles) per attempt per 10 minutes. */
const ANSWER_RATE = { limit: 900, windowSeconds: 600 };
const PAPER_RATE = { limit: 120, windowSeconds: 600 };
const EVENT_RATE = { limit: 120, windowSeconds: 600 };
const MAX_ID_LENGTH = 64;

/**
 * Candidate-safe projection: everything the exam page needs and nothing else.
 * `correctOptionIds`, topic and difficulty are never read for candidates.
 */
const CANDIDATE_QUESTION_PROJECTION = {
  _id: 1,
  order: 1,
  sectionId: 1,
  type: 1,
  prompt: 1,
  options: 1,
  marks: 1,
} as const;
type CandidateQuestion = Pick<
  QuestionDoc,
  "_id" | "order" | "sectionId" | "type" | "prompt" | "options" | "marks"
>;

const invalid = (message: string) => new DomainError(API_ERROR.VALIDATION_ERROR, 422, message);
const questionNotFound = () =>
  new DomainError(API_ERROR.NOT_FOUND, 404, "This question isn't part of your exam.");

function toAnswerState(questionId: ObjectId, doc: CandidateAnswerDoc | null): AnswerState {
  return {
    questionId: questionId.toHexString(),
    selectedOptionId: doc?.selectedOptionIds[0] ?? null,
    markedForReview: doc?.markedForReview ?? false,
    visited: Boolean(doc?.visitedAt),
    answerVersion: doc?.answerVersion ?? 0,
    savedAt: doc?.savedAt ? doc.savedAt.toISOString() : null,
  };
}

function toEventItem(doc: ProctoringEventDoc): ProctoringEventItem {
  const meta = PROCTORING_EVENTS[doc.type];
  return {
    id: doc._id.toHexString(),
    type: doc.type,
    label: meta.label,
    description: meta.description,
    severity: doc.severity,
    occurredAt: doc.occurredAt.toISOString(),
    source: doc.source,
  };
}

/**
 * The running exam: question paper, answers and proctoring events. Every call
 * goes through `requireActiveAttempt` (authentication, ownership, IN_PROGRESS,
 * server-side timeout) before touching questions or answers.
 */
export function createExamPaperService(db: Db, clock: () => Date = () => new Date()) {
  const c = getCollections(db);
  const sessions = createExamSessionService(db, clock);
  const audit = createAuditLogRepository(db);

  const rateKey = (kind: string, attempt: ExamAttemptDoc) =>
    `paper:${kind}:${attempt.candidateId.toHexString()}:${attempt._id.toHexString()}`;

  async function findQuestion(attempt: ExamAttemptDoc, questionIdRaw: string) {
    if (!/^[a-f\d]{24}$/i.test(questionIdRaw)) throw questionNotFound();
    // The exam is part of the query: a question from another exam is simply "not found".
    const question = await c.questions.findOne({
      _id: new ObjectId(questionIdRaw),
      examId: attempt.examId,
    });
    if (!question) throw questionNotFound();
    return question;
  }

  /**
   * The write fence. Inside the transaction this touches the attempt only while
   * it is still IN_PROGRESS and before its deadline, so a concurrent submission
   * or timeout conflicts with the answer write instead of racing past it.
   */
  async function fence(attempt: ExamAttemptDoc, now: Date, session: ClientSession | undefined) {
    const res = await c.examAttempts.updateOne(
      { _id: attempt._id, status: ATTEMPT_STATUS.IN_PROGRESS, expiresAt: { $gt: now } },
      { $set: { lastAnswerAt: now } },
      { session },
    );
    if (res.matchedCount !== 1) {
      throw new DomainError(
        API_ERROR.ATTEMPT_SUBMITTED,
        409,
        "This exam has been submitted. Answers can no longer be changed.",
      );
    }
  }

  function parseRequest(body: unknown): SaveAnswerRequest {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw invalid("The request is invalid.");
    }
    const b = body as Record<string, unknown>;
    const out: SaveAnswerRequest = {};
    if ("selectedOptionId" in b) {
      const v = b.selectedOptionId;
      if (v !== null && (typeof v !== "string" || !v || v.length > MAX_ID_LENGTH)) {
        throw invalid("Choose one of the listed options.");
      }
      if (!Number.isInteger(b.expectedVersion) || (b.expectedVersion as number) < 0) {
        throw invalid("The request is invalid.");
      }
      out.selectedOptionId = v as string | null;
      out.expectedVersion = b.expectedVersion as number;
      if (b.requestId !== undefined) {
        if (typeof b.requestId !== "string" || !/^[\w-]{8,64}$/.test(b.requestId)) {
          throw invalid("The request is invalid.");
        }
        out.requestId = b.requestId;
      }
    }
    if ("markedForReview" in b) {
      if (typeof b.markedForReview !== "boolean") throw invalid("The request is invalid.");
      out.markedForReview = b.markedForReview;
    }
    if ("visited" in b) {
      if (b.visited !== true) throw invalid("The request is invalid.");
      out.visited = true;
    }
    if (
      out.selectedOptionId === undefined &&
      out.markedForReview === undefined &&
      out.visited === undefined
    ) {
      throw invalid("Nothing to save.");
    }
    return out;
  }

  /**
   * Stores the event, then applies the exam's event policy in the same
   * transaction: warn (audited), flag for human review (audited once per event
   * type), or — only for trusted sources with automatic termination enabled —
   * end and submit the exam. The browser's word alone never ends an exam.
   */
  async function recordWithPolicy(
    attempt: ExamAttemptDoc,
    type: ProctoringEventType,
    source: EventSource,
    ctx: AuditContext,
  ): Promise<RecordEventResponse> {
    const now = clock();
    const snapshot = await c.examSessions.findOne(
      { attemptId: attempt._id },
      { projection: { proctoringPolicy: 1 } },
    );
    const policy = resolveEventPolicy(snapshot?.proctoringPolicy.eventPolicy);
    const subject = {
      attemptId: attempt._id,
      examId: attempt.examId,
      candidateId: attempt.candidateId,
      context: ctx,
      at: now,
    };

    const outcome = await inTransactionIfSupported(async (session) => {
      const previous = await c.proctoringEvents.countDocuments(
        { attemptId: attempt._id, type },
        { session },
      );
      const decision = evaluateEvent({ type, source, count: previous + 1, policy });
      const doc: ProctoringEventDoc = {
        _id: new ObjectId(),
        attemptId: attempt._id,
        examId: attempt.examId,
        candidateId: attempt.candidateId,
        type,
        severity: PROCTORING_EVENTS[type].severity,
        occurredAt: now,
        source,
        metadata: {},
        enforcement: decision,
        createdAt: now,
      };
      await c.proctoringEvents.insertOne(doc, { session });
      await audit.record(
        {
          ...subject,
          eventType: AUDIT_EVENT.PROCTORING_EVENT_RECORDED,
          actorType: "SYSTEM",
          actorId: null,
          metadata: { type, severity: doc.severity, source, action: decision.action },
        },
        session,
      );

      let examEnded = false;
      if (decision.action === "WARN") {
        await audit.record(
          {
            ...subject,
            eventType: AUDIT_EVENT.CANDIDATE_WARNED,
            actorType: "SYSTEM",
            actorId: null,
            metadata: { type, count: decision.count },
          },
          session,
        );
      } else if (decision.action === "REVIEW") {
        const reason = decision.terminationRecommended ? `${type}:TERMINATION_RECOMMENDED` : type;
        const flagged = await c.examAttempts.updateOne(
          { _id: attempt._id, "review.reasons": { $ne: reason } },
          {
            $set: { "review.required": true },
            $min: { "review.flaggedAt": now },
            $addToSet: { "review.reasons": reason },
          },
          { session },
        );
        if (flagged.modifiedCount === 1) {
          await audit.record(
            {
              ...subject,
              eventType: AUDIT_EVENT.ATTEMPT_FLAGGED_FOR_REVIEW,
              actorType: "SYSTEM",
              actorId: null,
              metadata: {
                type,
                count: decision.count,
                source,
                terminationRecommended: decision.terminationRecommended,
              },
            },
            session,
          );
        }
      } else if (decision.action === "TERMINATE") {
        const ended = await c.examAttempts.updateOne(
          { _id: attempt._id, status: ATTEMPT_STATUS.IN_PROGRESS },
          {
            $set: {
              status: ATTEMPT_STATUS.SUBMITTED,
              submittedAt: now,
              closedReason: "POLICY_TERMINATION",
              updatedAt: now,
            },
          },
          { session },
        );
        if (ended.modifiedCount === 1) {
          examEnded = true;
          await audit.record(
            {
              ...subject,
              eventType: AUDIT_EVENT.EXAM_TERMINATED_BY_POLICY,
              actorType: "SYSTEM",
              actorId: null,
              metadata: { type, count: decision.count, source },
            },
            session,
          );
        }
      }
      return { doc, decision, examEnded };
    });

    const showNotice = outcome.decision.action === "WARN" || outcome.decision.action === "REVIEW";
    return {
      event: toEventItem(outcome.doc),
      notice: showNotice ? (CANDIDATE_NOTICES[type] ?? null) : null,
      examEnded: outcome.examEnded,
    };
  }

  return {
    /** GET /api/exam-attempts/:attemptId/paper */
    async getPaper(
      attemptId: string,
      candidateId: ObjectId,
      ctx: AuditContext,
    ): Promise<ExamPaperResponse> {
      const attempt = await sessions.requireActiveAttempt(attemptId, candidateId, ctx);
      await consumeRateLimit(db, rateKey("paper", attempt), PAPER_RATE);
      const [exam, questions, answers] = await Promise.all([
        c.exams.findOne({ _id: attempt.examId }, { projection: { sections: 1 } }),
        c.questions
          .find({ examId: attempt.examId }, { projection: CANDIDATE_QUESTION_PROJECTION })
          .sort({ order: 1 })
          .toArray() as Promise<CandidateQuestion[]>,
        c.candidateAnswers.find({ attemptId: attempt._id }).toArray(),
      ]);
      const byQuestion = new Map(answers.map((a) => [a.questionId.toHexString(), a]));
      const paperQuestions: PaperQuestion[] = questions.map((q, i) => ({
        id: q._id.toHexString(),
        number: i + 1,
        sectionId: q.sectionId ?? null,
        type: q.type,
        prompt: q.prompt,
        options: q.options.map((o) => ({ id: o.id, text: o.text })),
        marks: q.marks,
      }));
      const sections = (exam?.sections ?? []).map((s) => ({
        id: s.id,
        title: s.title,
        questionCount: paperQuestions.filter((q) => q.sectionId === s.id).length,
      }));
      return {
        sections: sections.filter((s) => s.questionCount > 0),
        questions: paperQuestions,
        answers: questions.map((q) =>
          toAnswerState(q._id, byQuestion.get(q._id.toHexString()) ?? null),
        ),
        serverTime: clock().toISOString(),
      };
    },

    /**
     * POST /api/exam-attempts/:attemptId/answers/:questionId
     * Answer changes need the version the client last saw: a racing request or a
     * second tab gets 409 ANSWER_CONFLICT with the current state instead of
     * silently overwriting it. A retried request (same requestId) is not a conflict.
     */
    async saveAnswer(
      attemptId: string,
      questionIdRaw: string,
      candidateId: ObjectId,
      body: unknown,
      ctx: AuditContext,
    ): Promise<AnswerState> {
      const attempt = await sessions.requireActiveAttempt(attemptId, candidateId, ctx);
      await consumeRateLimit(db, rateKey("answer", attempt), ANSWER_RATE);
      const req = parseRequest(body);
      const question = await findQuestion(attempt, questionIdRaw);

      if (req.selectedOptionId !== undefined) {
        if (!(SUPPORTED_QUESTION_TYPES as readonly string[]).includes(question.type)) {
          throw invalid("This question type can't be answered yet.");
        }
        if (
          req.selectedOptionId !== null &&
          !question.options.some((o) => o.id === req.selectedOptionId)
        ) {
          throw invalid("Choose one of the listed options.");
        }
      }

      const now = clock();
      const key = { attemptId: attempt._id, questionId: question._id };
      const onInsert = {
        _id: new ObjectId(),
        examId: attempt.examId,
        candidateId: attempt.candidateId,
        createdAt: now,
      };

      const write = async (session: ClientSession | undefined) => {
        await fence(attempt, now, session);

        if (req.selectedOptionId !== undefined) {
          // Decide the conflict by reading, not by provoking a duplicate-key error:
          // inside a transaction any write error aborts it. Racing transactions on
          // the same answer get a WriteConflict and are retried by the driver,
          // and the retry then sees the winner's version here.
          const current = await c.candidateAnswers.findOne(key, { session });
          if ((current?.answerVersion ?? 0) !== req.expectedVersion) return null;

          const selectedOptionIds = req.selectedOptionId ? [req.selectedOptionId] : [];
          const lastRequestId = req.requestId ?? null;
          if (!current) {
            const doc: CandidateAnswerDoc = {
              ...onInsert,
              ...key,
              selectedOptionIds,
              markedForReview: req.markedForReview ?? false,
              visitedAt: now,
              answerVersion: 1,
              lastRequestId,
              savedAt: now,
              updatedAt: now,
            };
            await c.candidateAnswers.insertOne(doc, { session });
            return doc;
          }
          const set: Partial<CandidateAnswerDoc> = {
            selectedOptionIds,
            savedAt: now,
            lastRequestId,
            updatedAt: now,
          };
          if (req.markedForReview !== undefined) set.markedForReview = req.markedForReview;
          // Conditional on the version too, for deployments without transactions.
          return c.candidateAnswers.findOneAndUpdate(
            { ...key, answerVersion: req.expectedVersion },
            { $set: set, $inc: { answerVersion: 1 }, $min: { visitedAt: now } },
            { returnDocument: "after", session },
          );
        }

        const set: Partial<CandidateAnswerDoc> = { updatedAt: now };
        if (req.markedForReview !== undefined) set.markedForReview = req.markedForReview;
        return c.candidateAnswers.findOneAndUpdate(
          key,
          {
            $set: set,
            ...(req.visited ? { $min: { visitedAt: now } } : {}),
            $setOnInsert: {
              ...onInsert,
              selectedOptionIds: [],
              answerVersion: 0,
              lastRequestId: null,
              savedAt: null,
              ...(req.markedForReview === undefined ? { markedForReview: false } : {}),
            },
          },
          { upsert: true, returnDocument: "after", session },
        );
      };

      let saved: CandidateAnswerDoc | null;
      try {
        saved = await inTransactionIfSupported(write);
      } catch (error) {
        // Two first-time upserts raced on the unique key; the retry finds the document.
        if (error instanceof MongoServerError && error.code === 11000) {
          saved = await inTransactionIfSupported(write);
        } else {
          throw error;
        }
      }

      if (!saved) {
        const current = await c.candidateAnswers.findOne(key);
        if (req.requestId && current?.lastRequestId === req.requestId) {
          return toAnswerState(question._id, current); // our own earlier write: not a conflict
        }
        throw new DomainError(
          API_ERROR.ANSWER_CONFLICT,
          409,
          "This answer was changed somewhere else. The latest saved answer is shown.",
          { answer: toAnswerState(question._id, current) },
        );
      }
      return toAnswerState(question._id, saved);
    },

    /**
     * POST /api/exam-attempts/:attemptId/proctoring-events
     * The browser reports what it observed; the server decides the label,
     * severity and timestamp, and records an audit event in the same transaction.
     */
    async recordEvent(
      attemptId: string,
      candidateId: ObjectId,
      body: unknown,
      ctx: AuditContext,
    ): Promise<RecordEventResponse> {
      const attempt = await sessions.requireActiveAttempt(attemptId, candidateId, ctx);
      await consumeRateLimit(db, rateKey("event", attempt), EVENT_RATE);
      const type = (body as { type?: unknown } | null)?.type;
      if (!isProctoringEventType(type)) throw invalid("Unknown event type.");
      // Everything the browser reports is an untrusted signal.
      return recordWithPolicy(attempt, type, "BROWSER", ctx);
    },

    /**
     * Server-side entry point for a TRUSTED detection service (no HTTP route:
     * an integration must call it from server code after verifying its source).
     */
    async recordTrustedEvent(
      attempt: ExamAttemptDoc,
      type: ProctoringEventType,
      ctx: AuditContext,
    ): Promise<RecordEventResponse> {
      return recordWithPolicy(attempt, type, "DETECTION_SERVICE", ctx);
    },

    /** GET /api/exam-attempts/:attemptId/proctoring-events?limit=N — newest first, own attempt only. */
    async listEvents(
      attemptId: string,
      candidateId: ObjectId,
      limitRaw: string | null,
      ctx: AuditContext,
    ): Promise<ProctoringEventsResponse> {
      const attempt = await sessions.requireActiveAttempt(attemptId, candidateId, ctx);
      const limit = Math.min(Math.max(Number.parseInt(limitRaw ?? "", 10) || 20, 1), 100);
      const filter = { attemptId: attempt._id };
      const [events, total] = await Promise.all([
        c.proctoringEvents.find(filter).sort({ occurredAt: -1 }).limit(limit).toArray(),
        c.proctoringEvents.countDocuments(filter),
      ]);
      return { events: events.map(toEventItem), total };
    },
  };
}
export type ExamPaperService = ReturnType<typeof createExamPaperService>;
