import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const authSource = fs.readFileSync('packages/app/remote-auth.mjs', 'utf8');
const uiSource = fs.readFileSync('packages/app/remote-auth-ui.mjs', 'utf8');
const prebootSource = fs.readFileSync('packages/app/preboot.mjs', 'utf8');
const deviceSource = fs.readFileSync('supabase/functions/device-auth/index.ts', 'utf8');
const computeSource = fs.readFileSync('supabase/functions/compute-kaggle-v58/index.ts', 'utf8');
const contract = fs.readFileSync('supabase/functions/device-auth/README.md', 'utf8');
const quotaMigration = fs.readFileSync('supabase/migrations/20260911175500_transparent_device_provision_quota.sql', 'utf8');

test('connected access is provisioned automatically without asking the user for login, email, password or code', () => {
  assert.match(authSource, /autoProvisionDevice\(\)/);
  assert.match(authSource, /action:'auto'/);
  assert.match(authSource, /return this\.autoProvisionDevice\(\)/);
  assert.match(authSource, /autoProvisionPromise/);
  assert.match(authSource, /syncSharedCredentials\(\)/);
  assert.match(authSource, /userLoginUI:false/);
  assert.match(authSource, /passwordPrompt:false/);
  assert.match(authSource, /emailPrompt:false/);
  assert.match(authSource, /transparentDeviceAccess:true/);
  assert.match(authSource, /offlineMode:false/);
  assert.doesNotMatch(authSource, /service[_-]?role/i);
  assert.doesNotMatch(authSource, /OPENAI_API_KEY|GROQ_API_KEY|AI_GATEWAY_API_KEY/);

  assert.match(prebootSource, /installRemoteAuthUI/);
  assert.match(uiSource, /connectSilently/);
  assert.match(uiSource, /transparentDeviceAccess:\s*true/);
  assert.match(uiSource, /userLoginUI:\s*false/);
  assert.match(uiSource, /creatorSurfaceVisible:\s*false/);
  assert.doesNotMatch(uiSource, /Acesso do proprietário|Liberar meu estúdio|autocomplete="email"|Digite seu e-mail/);
});

test('transparent auto-provisioning is edge-admitted, rate-limited and stores no raw network address', () => {
  assert.match(deviceSource, /AUTO_PROVISION_DAILY_LIMIT=4/);
  assert.match(deviceSource, /cf-connecting-ip/);
  assert.match(deviceSource, /hmac256/);
  assert.match(deviceSource, /consume_transparent_device_quota/);
  assert.match(deviceSource, /edge_network_hmac_daily_quota_v1/);
  assert.match(deviceSource, /device_provision_rate_limited/);
  assert.doesNotMatch(deviceSource, /network_hash:network|ip_address|raw_ip/);

  assert.match(quotaMigration, /transparent_device_provision_quota/);
  assert.match(quotaMigration, /consume_transparent_device_quota/);
  assert.match(quotaMigration, /enable row level security/i);
  assert.match(quotaMigration, /grant execute[\s\S]*service_role/i);
  assert.match(quotaMigration, /revoke all[\s\S]*anon, authenticated/i);
});

test('automatic app device identity is server-side and can use shared GPU compute without owner-project access', () => {
  assert.match(deviceSource, /action==='auto'/);
  assert.match(deviceSource, /automaticDevice/);
  assert.match(deviceSource, /pablovoice_app_device:true/);
  assert.match(deviceSource, /access_profile:'unified_online'/);
  assert.match(deviceSource, /transparent_device_access:true/);
  assert.match(deviceSource, /user_login_ui:false/);
  assert.match(deviceSource, /password_prompt:false/);
  assert.match(deviceSource, /offline_mode:false/);
  assert.doesNotMatch(deviceSource, /password[,}]\s*device_token/);

  assert.match(computeSource, /sharedComputeConnection/);
  assert.match(computeSource, /pablovoice_app_device===true/);
  assert.match(computeSource, /B09_PROJECT_ID/);
  assert.match(computeSource, /\.eq\('user_id',user\.id\)/);
  assert.match(computeSource, /access_mode:'transparent_device'/);
  assert.match(computeSource, /user_login_required:false/);
});

test('legacy bootstrap remains hash-only and single-use for internal gates, not product access UI', () => {
  assert.match(contract, /SHA-256/);
  assert.match(contract, /unused and unexpired/i);
  assert.match(contract, /reuse fails closed/i);
  assert.match(contract, /Only the token hash is stored/i);
  assert.doesNotMatch(uiSource, /loginWithBootstrapCode|bootstrap_invalid|bootstrap_used/);
});
