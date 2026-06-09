import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const supabaseUrl =
  process.env.BEXHR_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "";

const supabasePublishableKey =
  process.env.BEXHR_SUPABASE_PUBLISHABLE_KEY ||
  process.env.BEXHR_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

const targetFile = resolve("js", "runtime-config.js");

mkdirSync(dirname(targetFile), { recursive: true });

const content = `// HRP-ENV - Runtime Supabase config generated during build.
// Do not put service-role keys or database passwords in this file.
window.BEXHR_RUNTIME_CONFIG = Object.freeze({
  SUPABASE_URL: ${JSON.stringify(supabaseUrl)},
  SUPABASE_PUBLISHABLE_KEY: ${JSON.stringify(supabasePublishableKey)}
});
`;

writeFileSync(targetFile, content);
console.log(`Generated ${targetFile}`);
