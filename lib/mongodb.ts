import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;

const globalForMongo = globalThis as unknown as {
  mongoClientPromise?: Promise<MongoClient>;
};

let mongoClientPromise = globalForMongo.mongoClientPromise;

export function getMongoClient() {
  if (!uri) {
    throw new Error('MONGODB_URI is not defined');
  }

  if (!mongoClientPromise) {
    const client = new MongoClient(uri);
    mongoClientPromise = client.connect();

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
