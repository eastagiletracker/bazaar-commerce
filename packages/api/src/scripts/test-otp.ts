import { ExecArgs } from "@medusajs/framework/types";
import { OTP_CONFIG, OtpService, generateCode } from "../lib/otp";
import { normalisePkMobile } from "../lib/sms";

/**
 * OTP tests. An OTP endpoint is the most abused surface on a consumer site, so
 * these assert the abuse guards rather than just the happy path.
 *
 * Run: bun run test:otp
 */

let checks = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = "") {
  checks += 1;
  console.log(
    `  ${String(checks).padStart(2, "0")}. ${condition ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`
  );
  if (!condition) failures.push(label);
}

/** In-memory Redis stand-in with working TTLs, so tests need no real server. */
function fakeRedis() {
  const store = new Map<string, { v: string; exp: number | null }>();
  const live = (k: string) => {
    const e = store.get(k);
    if (!e) return null;
    if (e.exp !== null && e.exp <= Date.now()) {
      store.delete(k);
      return null;
    }
    return e;
  };
  return {
    _store: store,
    async get(k: string) {
      return live(k)?.v ?? null;
    },
    async set(k: string, v: string, _mode?: string, ttl?: number) {
      store.set(k, { v, exp: ttl ? Date.now() + ttl * 1000 : null });
    },
    async del(k: string) {
      store.delete(k);
    },
    async incr(k: string) {
      const cur = Number(live(k)?.v ?? 0) + 1;
      const exp = live(k)?.exp ?? null;
      store.set(k, { v: String(cur), exp });
      return cur;
    },
    async expire(k: string, s: number) {
      const e = live(k);
      if (e) store.set(k, { v: e.v, exp: Date.now() + s * 1000 });
    },
    async ttl(k: string) {
      const e = live(k);
      if (!e || e.exp === null) return -1;
      return Math.ceil((e.exp - Date.now()) / 1000);
    },
  };
}

export default async function testOtp(_: ExecArgs) {
  console.log("\nPhone OTP test\n");

  // ------------------------------------------------ number normalisation
  const goodForms = [
    "03001234567",
    "0300-1234567",
    "+92 300 1234567",
    "92 300 1234567",
    "3001234567",
    "+923001234567",
  ];
  check(
    "Every way people write a PK mobile normalises to one E.164 value",
    goodForms.every((f) => normalisePkMobile(f) === "+923001234567"),
    goodForms.map((f) => `${f}→${normalisePkMobile(f)}`).join("  ")
  );

  for (const bad of ["", "123", "0300123456", "030012345678", "02112345678", "notaphone"]) {
    check(`Rejects ${JSON.stringify(bad)}`, normalisePkMobile(bad) === null);
  }

  // ------------------------------------------------------------- codes
  const codes = new Set(Array.from({ length: 400 }, () => generateCode()));
  check("Codes are 6 digits", [...codes].every((c) => /^\d{6}$/.test(c)));
  check(
    "Codes are not obviously predictable",
    codes.size > 350,
    `${codes.size} distinct in 400 draws`
  );

  // ------------------------------------------------------- happy path
  const phone = "+923001234567";
  {
    const otp = new OtpService(fakeRedis() as never);
    const issued = await otp.issue(phone);
    check("Issues a code", issued.ok === true);
    if (issued.ok) {
      const wrong = await otp.verify(phone, "000000");
      check(
        "A wrong code is rejected",
        !wrong.ok && wrong.reason === "invalid",
        (wrong as { reason?: string }).reason
      );
      const right = await otp.verify(phone, issued.code);
      check("The right code verifies", right.ok === true);
      const replay = await otp.verify(phone, issued.code);
      check(
        "Codes are single use — a replay fails",
        !replay.ok,
        "otherwise an intercepted SMS is reusable forever"
      );
    }
  }

  // ------------------------------------------------ brute force defence
  {
    const otp = new OtpService(fakeRedis() as never);
    const issued = await otp.issue(phone);
    if (!issued.ok) throw new Error("issue failed");

    // EXACTLY the cap, no more. Looping past it would burn the code via the
    // lockout path and then the next assertion passes for the wrong reason —
    // which is what an earlier version of this test did, and it survived
    // deleting the cap entirely.
    const outcomes: string[] = [];
    for (let i = 0; i < OTP_CONFIG.MAX_ATTEMPTS; i++) {
      const r = await otp.verify(phone, "111111");
      outcomes.push(r.ok ? "ok" : r.reason);
    }
    check(
      `${OTP_CONFIG.MAX_ATTEMPTS} wrong guesses are all rejected`,
      outcomes.every((o) => o !== "ok"),
      outcomes.join(",")
    );
    check(
      "The cap is reported on the final guess",
      outcomes[outcomes.length - 1] === "too_many_attempts",
      outcomes.join(",")
    );

    // The control that matters: once the cap is hit, the CORRECT code must
    // stop working. Otherwise an attacker simply keeps guessing until they
    // land on it.
    const afterCap = await otp.verify(phone, issued.code);
    check(
      "The correct code no longer works once the cap is hit",
      !afterCap.ok,
      `got ${afterCap.ok ? "ACCEPTED" : (afterCap as { reason: string }).reason} — a code that still works after lockout makes the cap pointless`
    );
  }

  // ------------------------------------------------------ SMS pumping
  {
    const otp = new OtpService(fakeRedis() as never);
    const first = await otp.issue(phone);
    check("First send allowed", first.ok === true);

    const immediate = await otp.issue(phone);
    check(
      "A second send straight away is refused",
      !immediate.ok && immediate.reason === "cooldown",
      "without a cooldown, one script makes us pay for unlimited SMS"
    );
  }

  {
    // Hourly ceiling, bypassing the cooldown the way a distributed attacker
    // would by waiting it out.
    const redis = fakeRedis();
    const otp = new OtpService(redis as never);
    let refusedAt = 0;
    for (let i = 1; i <= OTP_CONFIG.MAX_SENDS_PER_HOUR + 2; i++) {
      const r = await otp.issue(phone);
      if (!r.ok && r.reason === "hourly_limit") {
        refusedAt = i;
        break;
      }
      await redis.del(`otp:cooldown:${phone}`);
    }
    check(
      `Hourly ceiling stops sends after ${OTP_CONFIG.MAX_SENDS_PER_HOUR}`,
      refusedAt === OTP_CONFIG.MAX_SENDS_PER_HOUR + 1,
      `refused at send ${refusedAt}`
    );
  }

  // --------------------------------------------------------- expiry
  {
    const redis = fakeRedis();
    const otp = new OtpService(redis as never);
    const issued = await otp.issue(phone);
    if (!issued.ok) throw new Error("issue failed");

    // Expire it the way time would.
    redis._store.delete(`otp:${phone}`);
    const expired = await otp.verify(phone, issued.code);
    check(
      "An expired code fails",
      !expired.ok && expired.reason === "expired",
      (expired as { reason?: string }).reason
    );
  }

  // ------------------------------------------------------- storage
  {
    const redis = fakeRedis();
    const otp = new OtpService(redis as never);
    const issued = await otp.issue(phone);
    if (!issued.ok) throw new Error("issue failed");

    const stored = await redis.get(`otp:${phone}`);
    check(
      "The plaintext code is never stored",
      Boolean(stored) && !stored!.includes(issued.code),
      "a Redis dump must not hand over live codes"
    );

    const ttl = await redis.ttl(`otp:${phone}`);
    check(
      "The code carries a TTL",
      ttl > 0 && ttl <= OTP_CONFIG.CODE_TTL_SECONDS,
      `${ttl}s`
    );
  }

  console.log("");
  if (failures.length) {
    console.log(`${failures.length} of ${checks} checks FAILED:`);
    failures.forEach((f) => console.log(`  - ${f}`));
    throw new Error(`${failures.length} OTP checks failed`);
  }
  console.log(`All ${checks} OTP checks passed.\n`);
}
