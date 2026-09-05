-- AlterTable
ALTER TABLE "queue_entries" ADD COLUMN "user_id" TEXT;

-- CreateIndex
CREATE INDEX "queue_entries_user_id_idx" ON "queue_entries"("user_id");

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
