import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260813123725 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "pk_order_confirmation" drop constraint if exists "pk_order_confirmation_order_id_unique";`);
    this.addSql(`create table if not exists "pk_confirmation_attempt" ("id" text not null, "confirmation_id" text not null, "order_id" text not null, "sequence" integer not null, "channel" text check ("channel" in ('whatsapp', 'sms', 'call')) not null, "status" text check ("status" in ('sent', 'failed', 'skipped')) not null, "provider_message_id" text null, "error" text null, "agent_id" text null, "note" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "pk_confirmation_attempt_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_confirmation_attempt_deleted_at" ON "pk_confirmation_attempt" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_confirmation_attempt_confirmation_id" ON "pk_confirmation_attempt" ("confirmation_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_confirmation_attempt_order_id" ON "pk_confirmation_attempt" ("order_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "pk_order_confirmation" ("id" text not null, "order_id" text not null, "seller_id" text not null, "customer_id" text null, "phone" text not null, "payment_method" text not null, "currency_code" text not null default 'pkr', "order_amount" numeric not null, "status" text check ("status" in ('pending', 'awaiting_buyer', 'escalated', 'confirmed', 'cancelled')) not null default 'pending', "policy" text check ("policy" in ('auto', 'verify', 'strict')) not null, "risk_band" text check ("risk_band" in ('low', 'medium', 'high')) not null, "risk_score" integer not null default 0, "risk_reasons" jsonb null, "token_hash" text null, "token_expires_at" timestamptz null, "attempts" integer not null default 0, "last_attempt_at" timestamptz null, "next_action_at" timestamptz null, "confirmed_at" timestamptz null, "confirmed_via" text null, "resolved_by" text null, "cancelled_at" timestamptz null, "cancel_reason" text null, "raw_order_amount" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "pk_order_confirmation_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pk_order_confirmation_order_id_unique" ON "pk_order_confirmation" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_order_confirmation_deleted_at" ON "pk_order_confirmation" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_order_confirmation_status_next_action_at" ON "pk_order_confirmation" ("status", "next_action_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_order_confirmation_seller_id_status" ON "pk_order_confirmation" ("seller_id", "status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_order_confirmation_token_hash" ON "pk_order_confirmation" ("token_hash") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_order_confirmation_phone" ON "pk_order_confirmation" ("phone") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "pk_confirmation_attempt" cascade;`);

    this.addSql(`drop table if exists "pk_order_confirmation" cascade;`);
  }

}
