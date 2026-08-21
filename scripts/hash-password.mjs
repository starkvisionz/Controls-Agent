/**
 * Prints a `scrypt$salt$hash` value for STARKVISIONZ_AUTH_PASSWORD, so the deployed
 * environment never has to hold the plaintext.
 *
 *   npm run auth:hash -- 'the password'
 */
import { randomBytes, scryptSync } from "node:crypto";

const plain = process.argv[2];
if (!plain) {
  console.error("usage: npm run auth:hash -- '<password>'");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(plain, salt, 32);

console.log(`\nSTARKVISIONZ_AUTH_PASSWORD=scrypt$${salt.toString("hex")}$${hash.toString("hex")}`);
console.log(`STARKVISIONZ_SESSION_SECRET=${randomBytes(32).toString("hex")}\n`);
