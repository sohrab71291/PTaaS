-- AlterTable
ALTER TABLE "TestSpec" ADD COLUMN     "complexity" TEXT,
ADD COLUMN     "envVars" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "testType" TEXT;
