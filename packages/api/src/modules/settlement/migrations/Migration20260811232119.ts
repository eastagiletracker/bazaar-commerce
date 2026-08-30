import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260811232119 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "pk_order_settlement" drop constraint if exists "pk_order_settlement_order_id_unique";`);
    this.addSql(`alter table if exists "pk_ledger_entry" drop constraint if exists "pk_ledger_entry_idempotency_key_unique";`);
    this.addSql(`alter table if exists "pk_ledger_account" drop constraint if exists "pk_ledger_account_type_owner_id_unique";`);
    this.addSql(`alter table if exists "pk_courier_remittance" drop constraint if exists "pk_courier_remittance_courier_code_reference_unique";`);
    this.addSql(`create table if not exists "pk_courier_remittance" ("id" text not null, "courier_code" text not null, "reference" text not null, "currency_code" text not null default 'pkr', "declared_total" numeric not null, "matched_total" numeric not null default 0, "courier_fee_total" numeric not null default 0, "status" text check ("status" in ('received', 'reconciled', 'partially_reconciled')) not null default 'received', "received_at" timestamptz not null, "source_ref" text null, "raw_declared_total" jsonb not null, "raw_matched_total" jsonb not null default '{"value":"0","precision":20}', "raw_courier_fee_total" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "pk_courier_remittance_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_courier_remittance_deleted_at" ON "pk_courier_remittance" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pk_courier_remittance_courier_code_reference_unique" ON "pk_courier_remittance" ("courier_code", "reference") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "pk_courier_remittance_line" ("id" text not null, "courier_awb" text not null, "amount" numeric not null, "courier_fee" numeric not null default 0, "status" text check ("status" in ('matched', 'unmatched', 'amount_mismatch', 'duplicate')) not null default 'unmatched', "order_id" text null, "order_settlement_id" text null, "variance" numeric not null default 0, "note" text null, "remittance_id" text not null, "raw_amount" jsonb not null, "raw_courier_fee" jsonb not null default '{"value":"0","precision":20}', "raw_variance" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "pk_courier_remittance_line_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_courier_remittance_line_remittance_id" ON "pk_courier_remittance_line" ("remittance_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_courier_remittance_line_deleted_at" ON "pk_courier_remittance_line" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_courier_remittance_line_courier_awb" ON "pk_courier_remittance_line" ("courier_awb") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_courier_remittance_line_status" ON "pk_courier_remittance_line" ("status") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "pk_ledger_account" ("id" text not null, "type" text check ("type" in ('seller_payable', 'cod_receivable', 'psp_clearing', 'bank', 'commission_revenue', 'sales_tax_payable', 'withholding_tax_payable', 'settlement_loss')) not null, "owner_id" text null, "name" text not null, "currency_code" text not null default 'pkr', "normal_balance" text check ("normal_balance" in ('debit', 'credit')) not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "pk_ledger_account_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_ledger_account_deleted_at" ON "pk_ledger_account" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pk_ledger_account_type_owner_id_unique" ON "pk_ledger_account" ("type", "owner_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "pk_ledger_entry" ("id" text not null, "kind" text check ("kind" in ('order_placed', 'cod_collected', 'commission_charged', 'tax_withheld', 'remittance_received', 'payout_sent', 'rto_reversal', 'shortfall_written_off', 'adjustment')) not null, "idempotency_key" text not null, "reference_type" text null, "reference_id" text null, "currency_code" text not null default 'pkr', "description" text null, "reverses_entry_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "pk_ledger_entry_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pk_ledger_entry_idempotency_key_unique" ON "pk_ledger_entry" ("idempotency_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_ledger_entry_deleted_at" ON "pk_ledger_entry" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "pk_ledger_line" ("id" text not null, "account_id" text not null, "debit" numeric not null default 0, "credit" numeric not null default 0, "seller_id" text null, "order_id" text null, "description" text null, "entry_id" text not null, "raw_debit" jsonb not null default '{"value":"0","precision":20}', "raw_credit" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "pk_ledger_line_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_ledger_line_entry_id" ON "pk_ledger_line" ("entry_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_ledger_line_deleted_at" ON "pk_ledger_line" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "pk_order_settlement" ("id" text not null, "order_id" text not null, "seller_id" text not null, "currency_code" text not null default 'pkr', "payment_method" text check ("payment_method" in ('cod', 'prepaid')) not null, "status" text check ("status" in ('pending', 'collected', 'remitted', 'settled', 'rto', 'cancelled', 'exception')) not null default 'pending', "gross_amount" numeric not null, "commission_amount" numeric not null default 0, "commission_tax_amount" numeric not null default 0, "withholding_tax_amount" numeric not null default 0, "net_payable" numeric not null default 0, "cod_collected_amount" numeric null, "courier_code" text null, "courier_awb" text null, "collected_at" timestamptz null, "cod_remitted_at" timestamptz null, "settled_at" timestamptz null, "payout_id" text null, "raw_gross_amount" jsonb not null, "raw_commission_amount" jsonb not null default '{"value":"0","precision":20}', "raw_commission_tax_amount" jsonb not null default '{"value":"0","precision":20}', "raw_withholding_tax_amount" jsonb not null default '{"value":"0","precision":20}', "raw_net_payable" jsonb not null default '{"value":"0","precision":20}', "raw_cod_collected_amount" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "pk_order_settlement_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pk_order_settlement_order_id_unique" ON "pk_order_settlement" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_order_settlement_deleted_at" ON "pk_order_settlement" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_order_settlement_seller_id_status" ON "pk_order_settlement" ("seller_id", "status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_order_settlement_courier_code_courier_awb" ON "pk_order_settlement" ("courier_code", "courier_awb") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_order_settlement_status" ON "pk_order_settlement" ("status") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "pk_settlement_exception" ("id" text not null, "type" text check ("type" in ('unmatched_remittance', 'amount_mismatch', 'duplicate_remittance', 'remittance_overdue', 'payout_failed', 'payout_account_invalid')) not null, "status" text check ("status" in ('open', 'investigating', 'resolved', 'written_off')) not null default 'open', "severity" text check ("severity" in ('low', 'medium', 'high')) not null default 'medium', "currency_code" text not null default 'pkr', "amount" numeric not null default 0, "order_id" text null, "seller_id" text null, "courier_code" text null, "courier_awb" text null, "remittance_line_id" text null, "summary" text not null, "resolution_note" text null, "resolved_at" timestamptz null, "resolved_by" text null, "raw_amount" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "pk_settlement_exception_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_settlement_exception_deleted_at" ON "pk_settlement_exception" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_settlement_exception_status_severity" ON "pk_settlement_exception" ("status", "severity") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pk_settlement_exception_type" ON "pk_settlement_exception" ("type") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "pk_courier_remittance_line" add constraint "pk_courier_remittance_line_remittance_id_foreign" foreign key ("remittance_id") references "pk_courier_remittance" ("id") on update cascade;`);

    this.addSql(`alter table if exists "pk_ledger_line" add constraint "pk_ledger_line_entry_id_foreign" foreign key ("entry_id") references "pk_ledger_entry" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "pk_courier_remittance_line" drop constraint if exists "pk_courier_remittance_line_remittance_id_foreign";`);

    this.addSql(`alter table if exists "pk_ledger_line" drop constraint if exists "pk_ledger_line_entry_id_foreign";`);

    this.addSql(`drop table if exists "pk_courier_remittance" cascade;`);

    this.addSql(`drop table if exists "pk_courier_remittance_line" cascade;`);

    this.addSql(`drop table if exists "pk_ledger_account" cascade;`);

    this.addSql(`drop table if exists "pk_ledger_entry" cascade;`);

    this.addSql(`drop table if exists "pk_ledger_line" cascade;`);

    this.addSql(`drop table if exists "pk_order_settlement" cascade;`);

    this.addSql(`drop table if exists "pk_settlement_exception" cascade;`);
  }

}
