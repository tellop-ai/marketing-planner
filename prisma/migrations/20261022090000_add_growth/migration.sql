-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN "code" TEXT;

-- AlterTable
ALTER TABLE "enquiries" ADD COLUMN "code" TEXT;
ALTER TABLE "enquiries" ADD COLUMN "follow_up_on" TEXT;

-- AlterTable
ALTER TABLE "post_pictures" ADD COLUMN "layout" TEXT;
ALTER TABLE "post_pictures" ADD COLUMN "slide" INTEGER;
ALTER TABLE "post_pictures" ADD COLUMN "story" INTEGER;
ALTER TABLE "post_pictures" ADD COLUMN "subline" TEXT;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN "ask" TEXT;
ALTER TABLE "posts" ADD COLUMN "from_post_id" INTEGER;
ALTER TABLE "posts" ADD COLUMN "video_plan" TEXT;

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN "brand_colour" TEXT;
ALTER TABLE "profiles" ADD COLUMN "brand_colour_2" TEXT;
ALTER TABLE "profiles" ADD COLUMN "logo_on_pictures" BOOLEAN;
ALTER TABLE "profiles" ADD COLUMN "track_links" BOOLEAN;

-- AlterTable
ALTER TABLE "themes" ADD COLUMN "sells" BOOLEAN;

-- CreateTable
CREATE TABLE "followers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "inspiration" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner_id" TEXT NOT NULL,
    "link" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "theme_id" INTEGER,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "whatsapp_consent_on" TEXT,
    "email_consent_on" TEXT,
    "consent_how" TEXT NOT NULL DEFAULT '',
    "iys_on" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "followers_by_month" ON "followers"("owner_id", "month", "network");

-- CreateIndex
CREATE INDEX "inspiration_by_owner" ON "inspiration"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX "contacts_by_name" ON "contacts"("owner_id", "name");

-- CreateIndex
CREATE INDEX "enquiries_by_follow_up" ON "enquiries"("owner_id", "follow_up_on");
