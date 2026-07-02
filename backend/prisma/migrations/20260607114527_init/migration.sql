-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'TESTER', 'VIEWER');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('online', 'offline', 'busy');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'TESTER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestSpec" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tags" TEXT[],
    "request" JSONB NOT NULL,
    "loadProfile" JSONB NOT NULL,
    "thresholds" JSONB NOT NULL,
    "checks" TEXT[],
    "environmentId" TEXT,
    "lastRunStatus" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Execution" (
    "id" TEXT NOT NULL,
    "specId" TEXT,
    "specName" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "triggeredBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "scheduledFor" TIMESTAMP(3),
    "duration" INTEGER,
    "metrics" JSONB,
    "thresholdBreaches" INTEGER NOT NULL DEFAULT 0,
    "checksPassed" INTEGER NOT NULL DEFAULT 0,
    "checksFailed" INTEGER NOT NULL DEFAULT 0,
    "thresholdResults" JSONB NOT NULL DEFAULT '[]',
    "checkResults" JSONB NOT NULL DEFAULT '[]',
    "responseTimeSeries" JSONB NOT NULL DEFAULT '[]',
    "agentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Execution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Environment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "secrets" TEXT[],
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "executionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Environment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Secret" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "backend" TEXT NOT NULL,
    "backendPath" TEXT NOT NULL,
    "environments" TEXT[],
    "lastRotated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Secret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'offline',
    "hostname" TEXT,
    "lastSeen" TIMESTAMP(3),
    "k6Version" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_apiKey_key" ON "Agent"("apiKey");

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_specId_fkey" FOREIGN KEY ("specId") REFERENCES "TestSpec"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
