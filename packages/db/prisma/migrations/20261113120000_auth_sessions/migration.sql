-- Login sessions with an absolute lifetime and server-side revocation.
-- Access tokens carry the session id (sid); a revoked or expired session rejects
-- them immediately. Replaces refresh-token "families" and timestamp comparisons.

-- Existing refresh tokens predate sessions and cannot be attached to one, so they
-- are removed: anyone signed in simply signs in again.
DELETE FROM "refresh_tokens";

-- DropIndex
DROP INDEX "refresh_tokens_family_id_idx";

-- AlterTable
ALTER TABLE "refresh_tokens" DROP COLUMN "family_id",
ADD COLUMN     "session_id" UUID NOT NULL;

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A session always ends after it starts.
ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_expiry_after_start" CHECK ("expires_at" > "created_at");
