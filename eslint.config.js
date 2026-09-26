// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Edge Functions rodam em Deno: checadas com `deno check`/`deno test`.
    ignores: ["dist/*", "supabase/functions/**"],
  }
]);
