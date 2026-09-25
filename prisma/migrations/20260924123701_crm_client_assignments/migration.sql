-- CreateTable
CREATE TABLE "crm_client_assignments" (
    "clientName" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_client_assignments_pkey" PRIMARY KEY ("clientName","userId")
);

-- CreateIndex
CREATE INDEX "crm_client_assignments_userId_idx" ON "crm_client_assignments"("userId");

-- AddForeignKey
ALTER TABLE "crm_client_assignments" ADD CONSTRAINT "crm_client_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
