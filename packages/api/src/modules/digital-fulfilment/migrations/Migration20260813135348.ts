import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260813135348 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "pk_digital_delivery" add column if not exists "buyer_verified" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "pk_digital_delivery" drop column if exists "buyer_verified";`);
  }

}
