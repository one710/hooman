#!/usr/bin/env node
/**
 * Generate an argon2id hash for WEB_AUTH_PASSWORD_HASH.
 * Run: yarn hash-password   or   yarn hash-password --password=yourpassword
 * Add the printed line to your .env file.
 */
import argon2 from "argon2";
import { createInterface } from "readline";

function getPasswordFromArgv(): string | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--password=")) {
      return arg.slice("--password=".length);
    }
  }
  return null;
}

function promptPassword(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("Password: ", (answer) => {
      rl.close();
      resolve(answer ?? "");
    });
  });
}

async function main(): Promise<void> {
  let password = getPasswordFromArgv();
  if (password === null) {
    password = await promptPassword();
  }
  if (!password || !password.trim()) {
    console.error(
      "No password provided. Use --password=xxx or enter at prompt.",
    );
    process.exit(1);
  }
  const hash = await argon2.hash(password.trim(), { type: argon2.argon2id });
  console.log("\nAdd this line to your .env file:\n");
  console.log(`WEB_AUTH_PASSWORD_HASH=${hash}`);
  console.log(
    "\nAlso set WEB_AUTH_USERNAME and JWT_SECRET in .env to enable web login.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
