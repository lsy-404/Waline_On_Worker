import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
const { Miniflare } = wranglerRequire('miniflare');
const configPath = resolve(process.argv[2] || 'dist/overture/overture.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const temporary = await mkdtemp(new URL('./.runtime-', import.meta.url));
let runtime;
try {
  execFileSync('tar', ['-xzf', join(dirname(configPath), config.package.artifact), '-C', temporary]);
  runtime = new Miniflare({
    modules: true,
    scriptPath: join(temporary, config.worker.module),
    compatibilityDate: config.worker.compatibilityDate,
    compatibilityFlags: config.worker.compatibilityFlags || [],
    d1Databases: ['DB'],
    bindings: { JWT_SECRET: 'test-only-runtime-signing-key', IPQPS: '0' },
  });
  const database = await runtime.getD1Database('DB');
  const schemaFiles = (await readdir(temporary, { recursive: true })).filter(path => /(^|\/)schema\.sql$/i.test(path));
  assert.equal(schemaFiles.length, 1);
  const schema = await readFile(join(temporary, schemaFiles[0]), 'utf8');
  const statements = schema.replace(/--[^\n]*/g, '').split(';').map(value => value.trim()).filter(Boolean);
  const applySchema = () => database.batch(statements.map(statement => database.prepare(statement)));
  await applySchema();
  const request = (path, body, token, cf) => runtime.dispatchFetch(`https://runtime.example${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(cf ? { cf } : {}),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/api/token')).status, 401);
  const identity = { email: 'runtime@example.com', password: 'test-only-long-password' };
  const registration = await request('/api/user', identity);
  assert.equal(registration.status, 201);
  assert.equal((await registration.json()).data.type, 'administrator');
  const login = await request('/api/token', identity);
  assert.equal(login.status, 200);
  const { data: { token } } = await login.json();
  assert.ok(token);
  assert.equal((await request('/api/token', undefined, token)).status, 200);
  const location = { country: 'CA', region: 'Ontario', city: 'Toronto' };
  const comment = await request('/api/comment', { comment: 'Packaged runtime comment', url: '/smoke' }, token, location);
  assert.ok(comment.ok, `comment returned ${comment.status}`);
  const created = await comment.json();
  assert.equal(created.errno, 0);
  assert.equal(created.data.addr, 'CA Ontario');
  const list = await request('/api/comment?path=/smoke', undefined, undefined, { country: 'US', region: 'Texas', city: 'Austin' });
  assert.equal((await list.json()).data.data[0].addr, 'CA Ontario');
  await applySchema();
  assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM wl_Users').first()).count, 1);
  assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM wl_Comment').first()).count, 1);
  assert.equal((await database.prepare('SELECT country, region, city FROM wl_CommentRegion').first()).city, 'Toronto');
  assert.equal((await request('/api/token', undefined, token)).status, 200);
  console.log('PASS packaged Worker: home, unauthorized access, administrator registration, login, session, comment region persistence, schema replay');
} finally {
  await runtime?.dispose();
  await rm(temporary, { recursive: true, force: true });
}
