-- CreateTable
CREATE TABLE "ExecutionCredential" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "executionId" TEXT,
    "loginUrl" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExecutionCredential_batchId_idx" ON "ExecutionCredential"("batchId");

-- CreateIndex
CREATE INDEX "ExecutionCredential_executionId_idx" ON "ExecutionCredential"("executionId");
