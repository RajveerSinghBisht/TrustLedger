-- CreateTable
CREATE TABLE "users" (
    "did" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("did")
);

-- CreateTable
CREATE TABLE "encrypted_records" (
    "metadata_uri" TEXT NOT NULL,
    "asset_id" BIGINT NOT NULL,
    "encrypted_blob" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "auth_tag" BYTEA NOT NULL,
    "wrapped_data_key" BYTEA NOT NULL,
    "original_filename" TEXT,
    "mime_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encrypted_records_pkey" PRIMARY KEY ("metadata_uri")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_did" TEXT NOT NULL,
    "asset_id" BIGINT,
    "tx_hash" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_challenges" (
    "id" SERIAL NOT NULL,
    "nonce" TEXT NOT NULL,
    "did" TEXT NOT NULL,
    "expected_address" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "encrypted_records_asset_id_idx" ON "encrypted_records"("asset_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_did_idx" ON "audit_log"("actor_did");

-- CreateIndex
CREATE INDEX "audit_log_asset_id_idx" ON "audit_log"("asset_id");

-- CreateIndex
CREATE INDEX "audit_log_event_type_idx" ON "audit_log"("event_type");

-- CreateIndex
CREATE UNIQUE INDEX "auth_challenges_nonce_key" ON "auth_challenges"("nonce");

-- CreateIndex
CREATE INDEX "auth_challenges_did_consumed_idx" ON "auth_challenges"("did", "consumed");

-- CreateIndex
CREATE INDEX "auth_challenges_expires_at_idx" ON "auth_challenges"("expires_at");
