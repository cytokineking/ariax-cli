import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_BASE_URL,
  loadConfig,
  requireTrustedApiOrigin,
  supportsStoredCredentials,
} from '../src/config.js';

describe('API origin configuration', () => {
  it('defaults to the production Ariax origin', () => {
    assert.equal(loadConfig({}, {}).baseUrl, DEFAULT_BASE_URL);
  });

  it('allows official and loopback origins', () => {
    for (const baseUrl of ['https://ariax.bio', 'https://www.ariax.bio', 'http://localhost:3000', 'http://127.0.0.1:3000']) {
      const config = loadConfig({ 'base-url': baseUrl }, { ARIAX_API_KEY: 'arx_abcdefghijk' });
      assert.doesNotThrow(() => requireTrustedApiOrigin(config));
    }
  });

  it('uses stored credentials only with official Ariax origins', () => {
    assert.equal(supportsStoredCredentials('https://www.ariax.bio'), true);
    assert.equal(supportsStoredCredentials('https://ariax.bio'), true);
    assert.equal(supportsStoredCredentials('http://localhost:3000'), false);
    assert.equal(supportsStoredCredentials('https://api.example.test'), false);
  });

  it('rejects insecure and malformed base URLs', () => {
    assert.throws(() => loadConfig({ 'base-url': 'http://example.test' }, {}), /HTTPS/);
    assert.throws(() => loadConfig({ 'base-url': 'https://example.test/api' }, {}), /only an origin/);
    assert.throws(() => loadConfig({ 'base-url': 'not a url' }, {}), /valid absolute URL/);
  });

  it('requires an explicit opt-in before sending a key to a custom origin', () => {
    const blocked = loadConfig({ 'base-url': 'https://api.example.test' }, { ARIAX_API_KEY: 'arx_abcdefghijk' });
    assert.throws(() => requireTrustedApiOrigin(blocked), /Refusing to send/);

    const allowed = loadConfig(
      { 'base-url': 'https://api.example.test', 'allow-custom-origin': true },
      { ARIAX_API_KEY: 'arx_abcdefghijk' },
    );
    assert.doesNotThrow(() => requireTrustedApiOrigin(allowed));
  });
});
