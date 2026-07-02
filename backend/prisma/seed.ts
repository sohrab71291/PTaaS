import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env'), override: true });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as fs from 'fs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

function readJson(filename: string): any[] {
  const filePath = path.join(__dirname, '../data', filename);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    console.warn(`Could not read ${filename}, skipping`);
    return [];
  }
}

async function main() {
  console.log('Seeding database from JSON files...');

  const environments = readJson('environments.json');
  for (const env of environments) {
    await prisma.environment.upsert({
      where: { id: env.id },
      create: {
        id: env.id,
        name: env.name,
        baseUrl: env.baseUrl,
        variables: env.variables ?? [],
        secrets: env.secrets ?? [],
        requiresApproval: env.requiresApproval ?? false,
        executionCount: env.executionCount ?? 0,
        createdAt: new Date(env.createdAt),
        updatedAt: new Date(env.updatedAt),
      },
      update: {},
    });
  }
  console.log(`  Seeded ${environments.length} environments`);

  const secrets = readJson('secrets.json');
  for (const s of secrets) {
    await prisma.secret.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        name: s.name,
        backend: s.backend,
        backendPath: s.backendPath,
        environments: s.environments ?? [],
        lastRotated: new Date(s.lastRotated),
        expiresAt: s.expiresAt ? new Date(s.expiresAt) : null,
        status: s.status ?? 'active',
        createdAt: new Date(s.createdAt),
      },
      update: {},
    });
  }
  console.log(`  Seeded ${secrets.length} secrets`);

  const specs = readJson('test-specs.json');
  for (const spec of specs) {
    await prisma.testSpec.upsert({
      where: { id: spec.id },
      create: {
        id: spec.id,
        name: spec.name,
        description: spec.description ?? null,
        tags: spec.tags ?? [],
        request: spec.request,
        loadProfile: spec.loadProfile,
        thresholds: spec.thresholds ?? {},
        checks: spec.checks ?? [],
        environmentId: spec.environmentId ?? null,
        lastRunStatus: spec.lastRunStatus ?? null,
        lastRunAt: spec.lastRunAt ? new Date(spec.lastRunAt) : null,
        scheduledAt: spec.scheduledAt ? new Date(spec.scheduledAt) : null,
        createdAt: new Date(spec.createdAt),
        updatedAt: new Date(spec.updatedAt),
      },
      update: {},
    });
  }
  console.log(`  Seeded ${specs.length} test specs`);

  const executions = readJson('executions.json');
  for (const exec of executions) {
    await prisma.execution.upsert({
      where: { id: exec.id },
      create: {
        id: exec.id,
        specId: exec.specId ?? null,
        specName: exec.specName,
        environment: exec.environment,
        status: exec.status,
        triggeredBy: exec.triggeredBy,
        startedAt: exec.startedAt ? new Date(exec.startedAt) : null,
        finishedAt: exec.finishedAt ? new Date(exec.finishedAt) : null,
        scheduledFor: exec.scheduledFor ? new Date(exec.scheduledFor) : null,
        duration: exec.duration ?? null,
        metrics: exec.metrics ?? null,
        thresholdBreaches: exec.thresholdBreaches ?? 0,
        checksPassed: exec.checksPassed ?? 0,
        checksFailed: exec.checksFailed ?? 0,
        thresholdResults: exec.thresholdResults ?? [],
        checkResults: exec.checkResults ?? [],
        responseTimeSeries: exec.responseTimeSeries ?? [],
        createdAt: exec.startedAt ? new Date(exec.startedAt) : new Date(),
      },
      update: {},
    });
  }
  console.log(`  Seeded ${executions.length} executions`);

  console.log('Seed complete.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
