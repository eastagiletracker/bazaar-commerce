import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260813124949 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "pk_order_confirmation" add column if not exists "token_salt" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "pk_order_confirmation" drop column if exists "token_salt";`);
  }

}
