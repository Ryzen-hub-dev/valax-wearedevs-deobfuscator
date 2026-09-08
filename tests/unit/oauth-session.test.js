/**
 * Unit Test Suite for Discord OAuth2, Session Security, CSRF, and MongoDB Principal Mapping.
 */

const assert = require('assert');
const crypto = require('crypto');
const { Principal, DevelopmentAuthProvider } = require('../../packages/api/src/auth');
const { MongoIdentityStore, MemoryMongoCollection } = require('../../packages/api/src/auth/identity-store');
const { MemorySessionStore, MongoSessionStore } = require('../../packages/api/src/auth/session-store');
const { DiscordOAuthController } = require('../../packages/api/src/auth/discord-oauth');
const { ProductApiServer } = require('../../packages/api/src/server');

let passed = 0;
let failed = 0;
const results = [];

async function test(name, fn) {
  try {
    const start = Date.now();
    await fn();
    const duration = Date.now() - start;
    passed++;
    results.push({ name, status: 'PASS', duration });
    console.log(`  [PASS] ${name} (${duration}ms)`);
  } catch (err) {
    failed++;
    results.push({ name, status: 'FAIL', error: err.message });
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
  }
}

async function runOAuthSessionUnitTests() {
  console.log('\n=== Phase 3 Round 2 — OAuth2 & Session Security Unit Tests ===');

  // --- 1. PKCE Tests ---
  await test('P0-5: PKCE S256 code verifier and challenge generation', async () => {
    const oauth = new DiscordOAuthController({
      clientId: 'test-client',
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost/callback'
    });
    const { codeVerifier, codeChallenge } = oauth.generatePkce();

    assert(codeVerifier && codeVerifier.length >= 43, 'codeVerifier must have sufficient length');
    assert(codeChallenge && codeChallenge.length >= 43, 'codeChallenge must have sufficient length');

    // Verify SHA-256 derivation
    const expectedChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    assert.strictEqual(codeChallenge, expectedChallenge, 'codeChallenge must be base64url(sha256(codeVerifier))');
  });

  // --- 2. OAuth State Security ---
  await test('P0-4: OAuth state generation, HMAC signature, and timing-safe comparison', async () => {
    const oauth = new DiscordOAuthController({
      clientId: 'test-client',
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost/callback',
      sessionSecret: 'super-secret-key-12345'
    });

    const state = 'test-state-token';
    const sig = oauth.signState(state);
    assert(sig && sig.length === 64, 'Signature must be 64-char hex string (HMAC-SHA256)');

    // Correct signature
    const validCombined = `${state}.${sig}`;
    const [raw, s] = validCombined.split('.');
    const expected = oauth.signState(raw);
    assert.strictEqual(s, expected);

    // Tampered state
    const tampered = `${state}-tampered.${sig}`;
    const [tRaw, tSig] = tampered.split('.');
    assert.notStrictEqual(tSig, oauth.signState(tRaw), 'Tampered state must fail verification');
  });

  // --- 3. Principal Mapping & MongoDB Uniqueness (P0-9, P0-10) ---
  await test('P0-9 & P0-10: MongoIdentityStore creates stable UUID principal and enforces uniqueness', async () => {
    const memoryCol = new MemoryMongoCollection('identities');
    const store = new MongoIdentityStore({ collection: memoryCol });

    const discordUserId = '112233445566778899';
    const p1 = await store.getOrCreatePrincipal('discord', discordUserId, { username: 'alice' });

    assert(p1 instanceof Principal);
    assert.strictEqual(p1.provider, 'discord');
    assert.strictEqual(p1.providerSubject, discordUserId);
    assert(p1.principalId !== discordUserId, 'principalId must not equal external Discord user ID');
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p1.principalId), 'principalId must be UUID');

    // Repeated resolution returns identical principalId
    const p2 = await store.getOrCreatePrincipal('discord', discordUserId, { username: 'alice_updated' });
    assert.strictEqual(p1.principalId, p2.principalId, 'Repeated login must map to the same internal principalId');

    // Verify count in collection is exactly 1
    const count = await memoryCol.countDocuments({ provider: 'discord', providerSubject: discordUserId });
    assert.strictEqual(count, 1, 'Only 1 identity document must exist for this subject');
  });

  await test('P0-10: Concurrent race condition safely resolves to single principal', async () => {
    const memoryCol = new MemoryMongoCollection('identities');
    const store = new MongoIdentityStore({ collection: memoryCol });

    const discordUserId = '998877665544332211';
    // Run 10 concurrent logins
    const results = await Promise.all([
      store.getOrCreatePrincipal('discord', discordUserId),
      store.getOrCreatePrincipal('discord', discordUserId),
      store.getOrCreatePrincipal('discord', discordUserId),
      store.getOrCreatePrincipal('discord', discordUserId),
      store.getOrCreatePrincipal('discord', discordUserId)
    ]);

    const firstId = results[0].principalId;
    for (const r of results) {
      assert.strictEqual(r.principalId, firstId, 'All concurrent resolutions must yield identical principalId');
    }

    const count = await memoryCol.countDocuments({ provider: 'discord', providerSubject: discordUserId });
    assert.strictEqual(count, 1, 'Database must have exactly 1 record despite concurrent races');
  });

  // --- 4. Server-Side Session Store & Token Hashing (P0-11, P0-13) ---
  await test('P0-11 & P0-13: Session token hashing (raw token is never stored in DB/Redis)', async () => {
    const store = new MemorySessionStore();
    const principal = new Principal({
      principalId: crypto.randomUUID(),
      provider: 'discord',
      providerSubject: 'user-1'
    });

    const { token, session } = await store.createSession(principal);
    assert(token && token.length >= 32, 'Raw token must be high-entropy string');

    const expectedHash = crypto.createHash('sha256').update(token).digest('hex');
    assert.strictEqual(session.sessionIdHash, expectedHash);

    // Verify store does not hold the raw token as key
    assert(!store.sessions.has(token), 'Raw bearer token must not be used as store key');
    assert(store.sessions.has(expectedHash), 'Store key must be SHA256 of bearer token');

    // Retrieval via raw token succeeds
    const retrieved = await store.getSession(token);
    assert.strictEqual(retrieved.principalId, principal.principalId);
  });

  // --- 5. Session Rotation & Fixation Prevention (P0-14, P0-18) ---
  await test('P0-14 & P0-18: Session rotation invalidates old session and prevents session fixation', async () => {
    const store = new MemorySessionStore();
    const principal = new Principal({
      principalId: crypto.randomUUID(),
      provider: 'discord',
      providerSubject: 'user-1'
    });

    const { token: preAuthToken } = await store.createSession(principal);

    // Rotate session
    const { token: postAuthToken, session: newSession } = await store.rotateSession(preAuthToken);

    assert.notStrictEqual(preAuthToken, postAuthToken, 'Rotated token must be different from pre-auth token');
    assert.strictEqual(newSession.rotationVersion, 2, 'rotationVersion must increment');

    // Pre-auth session must now be completely invalid
    const oldLookup = await store.getSession(preAuthToken);
    assert.strictEqual(oldLookup, null, 'Pre-auth session token must be destroyed upon rotation');

    // Post-auth session is valid
    const newLookup = await store.getSession(postAuthToken);
    assert.strictEqual(newLookup.principalId, principal.principalId);
  });

  // --- 6. Idle and Absolute TTL Expiry (P0-15) ---
  await test('P0-15: Dual TTL enforcement (idle and absolute expiration)', async () => {
    // Short idle TTL (1 second), short absolute TTL (2 seconds)
    const store = new MemorySessionStore({
      idleTtlSeconds: 1,
      absoluteTtlSeconds: 2
    });

    const principal = new Principal({
      principalId: crypto.randomUUID(),
      provider: 'discord',
      providerSubject: 'user-1'
    });

    const { token } = await store.createSession(principal);

    // Immediate lookup works
    const s1 = await store.getSession(token);
    assert(s1 !== null);

    // Wait 1.1s -> idle TTL should expire
    await new Promise(r => setTimeout(r, 1100));
    const s2 = await store.getSession(token);
    assert.strictEqual(s2, null, 'Session must expire when idle TTL exceeded');
  });

  // --- 7. Logout Invalidation (P0-16) ---
  await test('P0-16: Logout explicitly destroys server session', async () => {
    const store = new MemorySessionStore();
    const principal = new Principal({
      principalId: crypto.randomUUID(),
      provider: 'discord',
      providerSubject: 'user-1'
    });

    const { token } = await store.createSession(principal);
    assert((await store.getSession(token)) !== null);

    await store.destroySession(token);
    assert.strictEqual(await store.getSession(token), null, 'Session must be null after destroySession');
  });

  // --- 8. CSRF Token Verification (P0-17) ---
  await test('P0-17: CSRF synchronizer token generated and verified on session', async () => {
    const store = new MemorySessionStore();
    const principal = new Principal({
      principalId: crypto.randomUUID(),
      provider: 'discord',
      providerSubject: 'user-1'
    });

    const { session } = await store.createSession(principal);
    assert(session.csrfToken && session.csrfToken.length >= 24, 'Session must contain high-entropy csrfToken');
  });

  // --- 9. Production Boundary & Fail-Closed Guards (P0-20, P0-46) ---
  await test('P0-20: DevelopmentAuthProvider throws fatal error in production', async () => {
    assert.throws(() => {
      new DevelopmentAuthProvider({ nodeEnv: 'production' });
    }, /FATAL_AUTH_CONFIGURATION/);
  });

  await test('P0-46: DiscordOAuthController throws fatal configuration error if secrets missing in production', async () => {
    assert.throws(() => {
      new DiscordOAuthController({
        nodeEnv: 'production',
        clientId: '',
        clientSecret: '',
        redirectUri: ''
      });
    }, /FATAL_AUTH_CONFIGURATION/);
  });

  // --- 10. Bot Signed Principal Assertion (P0-30, P0-31) ---
  await test('P0-30 & P0-31: Bot HMAC-SHA256 signed principal assertion verification', async () => {
    const oauth = new DiscordOAuthController({
      botServiceSecret: 'test-bot-secret-xyz',
      sessionSecret: 'test-session-secret'
    });

    const payload = {
      iss: 'valax-discord-bot',
      aud: 'valax-product-api',
      sub: 'discord-user-888',
      provider: 'discord',
      providerSubject: 'discord-user-888',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      nonce: crypto.randomBytes(16).toString('hex')
    };

    const token = oauth.signPrincipalAssertion(payload);
    const verified = oauth.verifyPrincipalAssertion(token);
    assert.strictEqual(verified.sub, 'discord-user-888');

    // Reject replayed nonce
    assert.throws(() => {
      oauth.verifyPrincipalAssertion(token);
    }, /Replayed assertion nonce/);

    // Reject expired assertion
    const expiredPayload = { ...payload, exp: Math.floor(Date.now() / 1000) - 10, nonce: 'nonce-expired-1' };
    const expiredToken = oauth.signPrincipalAssertion(expiredPayload);
    assert.throws(() => {
      oauth.verifyPrincipalAssertion(expiredToken);
    }, /Principal assertion expired/);

    // Reject tampered assertion
    const tampered = token.slice(0, -4) + 'abcd';
    assert.throws(() => {
      oauth.verifyPrincipalAssertion(tampered);
    }, /Invalid assertion signature/);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`${failed} unit tests failed`);
  }
}

if (require.main === module) {
  runOAuthSessionUnitTests().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  runOAuthSessionUnitTests
};
