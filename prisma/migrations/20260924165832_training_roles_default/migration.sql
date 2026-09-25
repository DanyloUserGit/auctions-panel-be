-- AlterTable
ALTER TABLE "training_materials" ALTER COLUMN "allowedRoles" SET DEFAULT ARRAY[]::"Roles"[];

-- Матеріали без вказаних ролей видимі всім ролям (раніше NULL ховав їх від усіх, крім SA).
UPDATE "training_materials" SET "allowedRoles" = '{}' WHERE "allowedRoles" IS NULL;
