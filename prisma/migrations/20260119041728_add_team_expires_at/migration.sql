-- AlterTable
ALTER TABLE "Team" ADD COLUMN "expiresAt" DATETIME;

-- CreateIndex
CREATE INDEX "Team_expiresAt_idx" ON "Team"("expiresAt");
