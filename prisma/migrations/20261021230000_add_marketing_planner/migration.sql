-- CreateTable
CREATE TABLE "profiles" (
    "owner_id" TEXT NOT NULL PRIMARY KEY,
    "business_name" TEXT NOT NULL DEFAULT '',
    "offer" TEXT NOT NULL DEFAULT '',
    "audience" TEXT NOT NULL DEFAULT '',
    "goal" TEXT NOT NULL DEFAULT '',
    "voice" TEXT NOT NULL DEFAULT '',
    "picture_style" TEXT NOT NULL DEFAULT '',
    "posts_per_week" INTEGER NOT NULL DEFAULT 3,
    "networks" TEXT NOT NULL DEFAULT '',
    "profile_link" TEXT NOT NULL DEFAULT '',
    "review_link" TEXT NOT NULL DEFAULT '',
    "show_days" TEXT NOT NULL DEFAULT 'both',
    "hidden_days" TEXT NOT NULL DEFAULT '',
    "logo_file" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "themes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "about" TEXT NOT NULL DEFAULT '',
    "colour" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "hashtags" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL DEFAULT '',
    "offer" TEXT NOT NULL DEFAULT '',
    "starts_on" TEXT NOT NULL,
    "ends_on" TEXT NOT NULL,
    "done_early" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "campaign_steps" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner_id" TEXT NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "due_on" TEXT NOT NULL DEFAULT '',
    "done" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "posts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "main_text" TEXT NOT NULL DEFAULT '',
    "day" TEXT,
    "time" TEXT,
    "theme_id" INTEGER,
    "campaign_id" INTEGER,
    "special_day" TEXT,
    "made_by" TEXT NOT NULL DEFAULT 'person',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "post_versions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner_id" TEXT NOT NULL,
    "post_id" INTEGER NOT NULL,
    "network" TEXT NOT NULL,
    "on" BOOLEAN NOT NULL DEFAULT true,
    "text" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "first_comment" TEXT NOT NULL DEFAULT '',
    "changed_by_person" BOOLEAN NOT NULL DEFAULT false,
    "must_fix" BOOLEAN NOT NULL DEFAULT false,
    "must_fix_with_picture" BOOLEAN NOT NULL DEFAULT false,
    "shared_at" TEXT,
    "shared_link" TEXT,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "clicks" INTEGER,
    "result_note" TEXT NOT NULL DEFAULT '',
    "result_at" TEXT,
    "send_state" TEXT,
    "send_error" TEXT,
    "sent_at" TEXT,
    "external_id" TEXT,
    "updated_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "post_pictures" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner_id" TEXT NOT NULL,
    "post_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "file" TEXT,
    "prompt" TEXT NOT NULL DEFAULT '',
    "change" TEXT NOT NULL DEFAULT '',
    "from_picture_id" INTEGER,
    "words" TEXT NOT NULL DEFAULT '',
    "comment_id" INTEGER,
    "chosen" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "focus_x" REAL NOT NULL DEFAULT 0.5,
    "focus_y" REAL NOT NULL DEFAULT 0.5,
    "fit" TEXT NOT NULL DEFAULT 'auto',
    "square_file" TEXT,
    "portrait_file" TEXT,
    "story_file" TEXT,
    "wide_file" TEXT,
    "landscape_file" TEXT,
    "tall_file" TEXT,
    "gbp_file" TEXT,
    "created_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ready_words" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "network" TEXT,
    "copied" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "customer_comments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "best_line" TEXT NOT NULL DEFAULT '',
    "stars" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'other',
    "received_on" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'not-asked',
    "permission_note" TEXT NOT NULL DEFAULT '',
    "screenshot_file" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "enquiries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL DEFAULT '',
    "channel" TEXT NOT NULL DEFAULT 'other',
    "post_id" INTEGER,
    "asked_about" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'new',
    "amount" INTEGER,
    "received_on" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "special_days" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "yearly" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "themes_by_owner" ON "themes"("owner_id", "position");

-- CreateIndex
CREATE INDEX "campaigns_by_owner" ON "campaigns"("owner_id", "starts_on");

-- CreateIndex
CREATE INDEX "campaign_steps_by_campaign" ON "campaign_steps"("owner_id", "campaign_id");

-- CreateIndex
CREATE INDEX "posts_by_day" ON "posts"("owner_id", "day");

-- CreateIndex
CREATE INDEX "posts_by_theme" ON "posts"("owner_id", "theme_id");

-- CreateIndex
CREATE INDEX "post_versions_by_shared" ON "post_versions"("owner_id", "shared_at");

-- CreateIndex
CREATE UNIQUE INDEX "post_versions_one_per_network" ON "post_versions"("owner_id", "post_id", "network");

-- CreateIndex
CREATE INDEX "post_pictures_by_post" ON "post_pictures"("owner_id", "post_id");

-- CreateIndex
CREATE INDEX "ready_words_by_kind" ON "ready_words"("owner_id", "kind");

-- CreateIndex
CREATE INDEX "customer_comments_by_day" ON "customer_comments"("owner_id", "received_on");

-- CreateIndex
CREATE INDEX "enquiries_by_day" ON "enquiries"("owner_id", "received_on");

-- CreateIndex
CREATE INDEX "special_days_by_date" ON "special_days"("owner_id", "date");
