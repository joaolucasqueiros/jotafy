#!/usr/bin/env bash
set -euo pipefail
cd /workspace/jotafy
export npm_config_cache=/workspace/.npm-cache
npm ci --no-audit --no-fund
# Preserve existing values and keys. Generate only a local development key for a new instance.
if [ ! -e .env.local ]; then
  node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const template = readFileSync('.env.example', 'utf8');
writeFileSync('.env.local', template.replace(/^ENCRYPTION_KEY=$/m, 'ENCRYPTION_KEY=' + randomBytes(32).toString('base64')), { mode: 0o600, flag: 'wx' });
JS
fi
# Only use Compose for a loopback development database; preserve external DATABASE_URL bindings.
if node --env-file-if-exists=.env.local --input-type=module -e 'const u=new URL(process.env.DATABASE_URL);process.exit(["localhost","127.0.0.1"].includes(u.hostname)?0:1)'; then
  docker compose up -d --wait db
fi
node --env-file-if-exists=.env.local --input-type=module -e 'if(Buffer.from(process.env.ENCRYPTION_KEY||"","base64").length!==32)throw new Error("Configure ENCRYPTION_KEY with 32 bytes in base64");'
npm run db:migrate
npm run build
