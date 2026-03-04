import { NextResponse } from 'next/server';
import { ObjectId, type Db } from 'mongodb';
import { getMongoDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const revalidate = 0;
const COLLECTION_NAME = 'candidate_conversations';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

let ensureConversationIndexesPromise: Promise<void> | null = null;

type ResumeSource = 'text' | 'pdf';
type PromptProfile = 'main' | 'dynamic';
type Speaker = 'user' | 'agent' | 'unknown';

interface ConversationRequestTranscriptItem {
  id?: unknown;
  type?: unknown;
  message?: unknown;
  timestamp?: unknown;
  fromIdentity?: unknown;
  fromName?: unknown;
  isLocal?: unknown;
}

interface ConversationRequestBody {
  roomName?: unknown;
  agentName?: unknown;
  promptProfile?: unknown;
  resume?: unknown;
  resumeSource?: unknown;
  transcript?: unknown;
  startedAt?: unknown;
}

interface StoredTranscriptItem {
  id: string;
  type: string;
  speaker: Speaker;
  message: string;
  timestamp: number;
  fromIdentity: string | null;
  fromName: string | null;
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

function normalizeSpeaker(item: ConversationRequestTranscriptItem): Speaker {
  if (item.type === 'userTranscript' || item.isLocal === true) {
    return 'user';
  }
  if (item.type === 'agentTranscript' || item.isLocal === false) {
    return 'agent';
  }
  return 'unknown';
}

function normalizeTranscript(value: unknown): StoredTranscriptItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const typedItem = item as ConversationRequestTranscriptItem;
      const message = normalizeString(typedItem.message);
      if (!message) {
        return null;
      }

      const rawTimestamp =
        typeof typedItem.timestamp === 'number' ? typedItem.timestamp : Date.now();

      return {
        id: normalizeString(typedItem.id) || `msg_${index + 1}`,
        type: normalizeString(typedItem.type) || 'chatMessage',
        speaker: normalizeSpeaker(typedItem),
        message,
        timestamp: Number.isFinite(rawTimestamp) ? rawTimestamp : Date.now(),
        fromIdentity: normalizeString(typedItem.fromIdentity) || null,
        fromName: normalizeString(typedItem.fromName) || null,
      };
    })
    .filter((item): item is StoredTranscriptItem => item !== null);
}

function normalizeDate(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeResumeSource(value: unknown): ResumeSource {
  return value === 'pdf' ? 'pdf' : 'text';
}

function normalizePromptProfile(value: unknown): PromptProfile {
  return value === 'dynamic' ? 'dynamic' : 'main';
}

async function ensureConversationIndexes(db: Db) {
  if (!ensureConversationIndexesPromise) {
    ensureConversationIndexesPromise = db
      .collection(COLLECTION_NAME)
      .createIndexes([
        {
          key: { createdAt: -1 },
          name: 'createdAt_desc',
        },
        {
          key: { roomName: 1, createdAt: -1 },
          name: 'roomName_createdAt_desc',
        },
      ])
      .then(() => undefined)
      .catch((error) => {
        ensureConversationIndexesPromise = null;
        throw error;
      });
  }

  await ensureConversationIndexesPromise;
}

export async function GET(req: Request) {
  try {
    const db = await getMongoDb();
    await ensureConversationIndexes(db);
    const collection = db.collection(COLLECTION_NAME);
    const url = new URL(req.url);

    const id = normalizeString(url.searchParams.get('id'));
    if (id) {
      if (!ObjectId.isValid(id)) {
        return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
      }

      const doc = await collection.findOne({ _id: new ObjectId(id) });
      if (!doc) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }

      return NextResponse.json({
        item: {
          ...doc,
          id: doc._id.toString(),
        },
      });
    }

    const limit = normalizeLimit(url.searchParams.get('limit'));
    const full = url.searchParams.get('full') === 'true';

    const docs = await collection
      .find(
        {},
        {
          projection: full
            ? {}
            : {
                roomName: 1,
                agentName: 1,
                promptProfile: 1,
                resume: 1,
                transcriptCount: 1,
                transcriptText: 1,
                startedAt: 1,
                endedAt: 1,
                createdAt: 1,
              },
        }
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    if (full) {
      return NextResponse.json({
        limit,
        count: docs.length,
        items: docs.map((doc) => ({
          ...doc,
          id: doc._id.toString(),
        })),
      });
    }

    return NextResponse.json({
      limit,
      count: docs.length,
      items: docs.map((doc) => {
        const resumeSource =
          doc && typeof doc === 'object' && 'resume' in doc
            ? (doc.resume as { source?: unknown } | undefined)?.source
            : null;
        const transcriptText =
          doc && typeof doc === 'object' && 'transcriptText' in doc
            ? (doc.transcriptText as string | undefined)
            : '';
        const resumeContent =
          doc && typeof doc === 'object' && 'resume' in doc
            ? (doc.resume as { content?: unknown } | undefined)?.content
            : '';

        return {
          id: doc._id.toString(),
          roomName: doc.roomName ?? null,
          agentName: doc.agentName ?? null,
          promptProfile: doc.promptProfile ?? null,
          resumeSource: resumeSource ?? null,
          resumePreview:
            typeof resumeContent === 'string' ? resumeContent.slice(0, 180) : '',
          transcriptCount:
            typeof doc.transcriptCount === 'number' ? doc.transcriptCount : 0,
          transcriptPreview:
            typeof transcriptText === 'string' ? transcriptText.slice(0, 240) : '',
          startedAt: doc.startedAt ?? null,
          endedAt: doc.endedAt ?? null,
          createdAt: doc.createdAt ?? null,
        };
      }),
    });
  } catch (error) {
    console.error('Failed to fetch candidate conversations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch candidate conversations' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ConversationRequestBody;
    const resume = normalizeString(body.resume);
    if (!resume) {
      return NextResponse.json({ error: 'resume is required' }, { status: 400 });
    }

    const transcript = normalizeTranscript(body.transcript);
    const now = new Date();
    const startedAt = normalizeDate(body.startedAt);

    const db = await getMongoDb();
    await ensureConversationIndexes(db);
    const result = await db.collection(COLLECTION_NAME).insertOne({
      roomName: normalizeString(body.roomName) || null,
      agentName: normalizeString(body.agentName) || null,
      promptProfile: normalizePromptProfile(body.promptProfile),
      resume: {
        source: normalizeResumeSource(body.resumeSource),
        content: resume,
      },
      transcript,
      transcriptText: transcript
        .map((line) => `${line.speaker.toUpperCase()}: ${line.message}`)
        .join('\n'),
      transcriptCount: transcript.length,
      startedAt,
      endedAt: now,
      createdAt: now,
    });

    return NextResponse.json({
      ok: true,
      id: result.insertedId.toString(),
    });
  } catch (error) {
    console.error('Failed to persist candidate conversation:', error);
    return NextResponse.json(
      { error: 'Failed to persist candidate conversation' },
      { status: 500 }
    );
  }
}
