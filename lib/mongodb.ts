import { MongoClient } from 'mongodb';

const primaryUri = process.env.MONGODB_URI;
const fallbackUri = process.env.MONGODB_URI_FALLBACK;

const globalForMongo = globalThis as unknown as {
  mongoClientPromise?: Promise<MongoClient>;
};

let mongoClientPromise = globalForMongo.mongoClientPromise;

function isSrvDnsLookupError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as {
    code?: string;
    errno?: string;
    syscall?: string;
    message?: string;
  };

  const code = maybeError.code ?? maybeError.errno ?? '';
  const syscall = maybeError.syscall ?? '';
  const message = maybeError.message ?? '';
  const dnsCode = code === 'ESERVFAIL' || code === 'ENOTFOUND' || code === 'ETIMEOUT';
  const isSrvLookup = syscall === 'queryTxt' || syscall === 'querySrv';
  const messageMentionsSrvLookup =
    message.includes('queryTxt') || message.includes('querySrv') || message.includes('mongodb+srv');

  return dnsCode && (isSrvLookup || messageMentionsSrvLookup);
}

async function connectWithFallback() {
  if (!primaryUri) {
    throw new Error('MONGODB_URI is not defined');
  }

  try {
    const primaryClient = new MongoClient(primaryUri);
    await primaryClient.connect();
    return primaryClient;
  } catch (error) {
    const canTryFallback =
      Boolean(fallbackUri) && primaryUri.startsWith('mongodb+srv://') && isSrvDnsLookupError(error);

    if (!canTryFallback) {
      throw error;
    }

    console.warn(
      'Primary MongoDB SRV connection failed due to DNS lookup issue. Retrying with MONGODB_URI_FALLBACK.'
    );

    const secondaryClient = new MongoClient(fallbackUri as string);
    await secondaryClient.connect();
    return secondaryClient;
  }
}

export function getMongoClient() {
  if (!mongoClientPromise) {
    mongoClientPromise = connectWithFallback();

    if (process.env.NODE_ENV !== 'production') {
      globalForMongo.mongoClientPromise = mongoClientPromise;
    }
  }

  return mongoClientPromise;
}

export async function getMongoDb() {
  const client = await getMongoClient();
  return client.db();
}
