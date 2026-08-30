import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260813133746 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "pk_digital_delivery" drop constraint if exists "pk_digital_delivery_order_line_id_unique";`);
    this.addSql(`alter table if exists "pk_digital_code" drop constraint if exists "pk_digital_code_line_unique";`);
    this.addSql(`alter table if exists "pk_digital_code" drop constraint if exists "pk_digital_code_fingerprint_unique";`);
    this.addSql(`create table if not exists "pk_digital_code" ("id" text not null, "seller_id" text not null, "offer_id" text not null, "variant_id" text null, "status" text check ("status" in ('available', 'allocated', 'delivered', 'voided')) not null default 'available', "ciphertext" text not null, "iv" text not null, "auth_tag" text not null, "fingerprint" text not null, "masked" text not null, "expires_at" timestamptz null, "allocated_to_line_id" text null, "allocated_to_order_id" text null, "allocated_at" timestamptz null, "delivered_at" timestamptz null, "voided_reason" text null, "batch_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "pk_digital_code_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_digital_code_deleted_at" ON "pk_digital_code" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pk_digital_code_fingerprint_unique" ON "pk_digital_code" ("seller_id", "fingerprint") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pk_digital_code_line_unique" ON "pk_digital_code" ("allocated_to_line_id") WHERE deleted_at IS NULL AND allocated_to_line_id IS NOT NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_digital_code_offer_id_status" ON "pk_digital_code" ("offer_id", "status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_digital_code_seller_id_status" ON "pk_digital_code" ("seller_id", "status") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "pk_digital_delivery" ("id" text not null, "order_line_id" text not null, "order_id" text not null, "seller_id" text not null, "offer_id" text null, "customer_id" text null, "phone" text null, "product_type" text not null, "quantity" integer not null default 1, "amount" numeric not null default 0, "currency_code" text not null default 'pkr', "status" text check ("status" in ('pending', 'held', 'ready', 'delivered', 'refused', 'out_of_stock', 'failed')) not null default 'pending', "fraud_decision" text check ("fraud_decision" in ('release', 'hold', 'refuse')) null, "fraud_score" integer not null default 0, "fraud_reasons" jsonb null, "reviewed_by" text null, "reviewed_at" timestamptz null, "review_note" text null, "fulfilment_input" jsonb null, "token_salt" text null, "token_hash" text null, "first_revealed_at" timestamptz null, "reveal_count" integer not null default 0, "delivered_at" timestamptz null, "sla_due_at" timestamptz null, "failure_reason" text null, "raw_amount" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "pk_digital_delivery_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pk_digital_delivery_order_line_id_unique" ON "pk_digital_delivery" ("order_line_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_digital_delivery_deleted_at" ON "pk_digital_delivery" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_digital_delivery_status" ON "pk_digital_delivery" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_digital_delivery_order_id" ON "pk_digital_delivery" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_digital_delivery_seller_id_status" ON "pk_digital_delivery" ("seller_id", "status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_digital_delivery_phone" ON "pk_digital_delivery" ("phone") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_digital_delivery_token_hash" ON "pk_digital_delivery" ("token_hash") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "pk_digital_code" cascade;`);

    this.addSql(`drop table if exists "pk_digital_delivery" cascade;`);
  }

}
