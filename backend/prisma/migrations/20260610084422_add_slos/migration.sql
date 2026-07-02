-- AlterTable
ALTER TABLE "Execution" ADD COLUMN     "sloResults" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "slos" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "TestSpec" ADD COLUMN     "slos" JSONB NOT NULL DEFAULT '[]';
