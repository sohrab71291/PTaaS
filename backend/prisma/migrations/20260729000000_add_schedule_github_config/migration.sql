-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "githubRepoUrl" TEXT,
ADD COLUMN     "githubBranch" TEXT,
ADD COLUMN     "githubScriptPath" TEXT,
ADD COLUMN     "githubToken" TEXT;
