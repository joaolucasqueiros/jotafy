import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// All business data is request-scoped in PostgreSQL; this app has no ISR/tag-cache routes.
export default defineCloudflareConfig({
  incrementalCache: 'dummy',
  tagCache: 'dummy',
  queue: 'dummy',
});
