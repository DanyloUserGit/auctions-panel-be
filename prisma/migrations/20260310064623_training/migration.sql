-- CreateEnum
CREATE TYPE "MaterialVisibility" AS ENUM ('All', 'Group');

-- CreateTable
CREATE TABLE "information_pages" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "information_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_materials" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "imageUrl" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "visibility" "MaterialVisibility" NOT NULL DEFAULT 'All',
    "allowedRoles" "Roles"[],
    "authorId" UUID NOT NULL,
    "groupId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_materials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "information_pages_slug_key" ON "information_pages"("slug");

-- AddForeignKey
ALTER TABLE "training_materials" ADD CONSTRAINT "training_materials_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_materials" ADD CONSTRAINT "training_materials_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "auction_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
