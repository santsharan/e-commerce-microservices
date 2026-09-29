import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";

const directory = path.resolve("secrets");
const privatePath = path.join(directory, "jwt-private.pem");
const publicPath = path.join(directory, "jwt-public.pem");

if (existsSync(privatePath) || existsSync(publicPath)) {
  process.stdout.write("JWT key files already exist. Leaving them in place.\n");
} else {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  mkdirSync(directory, { recursive: true });
  writeFileSync(privatePath, pair.privateKey.export({ type: "pkcs8", format: "pem" }));
  writeFileSync(publicPath, pair.publicKey.export({ type: "spki", format: "pem" }));
  process.stdout.write("Wrote secrets/jwt-private.pem and secrets/jwt-public.pem\n");
}
