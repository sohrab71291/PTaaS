-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "scmProvider" TEXT NOT NULL DEFAULT 'github',
ADD COLUMN     "gitlabRepoUrl" TEXT,
ADD COLUMN     "gitlabBranch" TEXT,
ADD COLUMN     "gitlabScriptPath" TEXT,
ADD COLUMN     "gitlabToken" TEXT;
