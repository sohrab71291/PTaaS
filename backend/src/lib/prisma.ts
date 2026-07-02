import * as dotenv from 'dotenv';
import * as path from 'path';
// Load env here as well — static imports are hoisted before index.ts can call dotenv.config()
dotenv.config({ path: path.join(__dirname, '../../.env'), override: true });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

export default prisma;
