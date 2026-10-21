import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EXIT, httpStatusToExit, errorCodeToExit } from '../src/exit-codes.js';
import { ApiError, NetworkError } from '../src/http.js';

describe('EXIT table', () => {
  it('has the documented stable values', () => {
    assert.equal(EXIT.OK, 0);
    assert.equal(EXIT.USAGE, 1);
    assert.equal(EXIT.AUTH, 2);
    assert.equal(EXIT.FORBIDDEN, 3);
    assert.equal(EXIT.NOT_FOUND, 4);
    assert.equal(EXIT.VALIDATION, 5);
    assert.equal(EXIT.PAYMENT, 6);
    assert.equal(EXIT.CONFLICT, 7);
    assert.equal(EXIT.RATE_LIMIT, 8);
    assert.equal(EXIT.NETWORK, 9);
    assert.equal(EXIT.SERVER, 10);
    assert.equal(EXIT.INTERRUPTED, 130);
  });

  it('is frozen', () => {
    assert.equal(Object.isFrozen(EXIT), true);
  });
});

describe('httpStatusToExit', () => {
  it('maps auth failures', () => {
    assert.equal(httpStatusToExit(401), EXIT.AUTH);
  });

  it('maps authorization failures', () => {
    assert.equal(httpStatusToExit(403), EXIT.FORBIDDEN);
  });

  it('maps not found', () => {
    assert.equal(httpStatusToExit(404), EXIT.NOT_FOUND);
  });

  it('maps validation statuses', () => {
    assert.equal(httpStatusToExit(400), EXIT.VALIDATION);
    assert.equal(httpStatusToExit(413), EXIT.VALIDATION);
    assert.equal(httpStatusToExit(422), EXIT.VALIDATION);
  });

  it('maps payment required', () => {
    assert.equal(httpStatusToExit(402), EXIT.PAYMENT);
  });

  it('maps conflict', () => {
    assert.equal(httpStatusToExit(409), EXIT.CONFLICT);
  });

  it('maps rate limiting', () => {
    assert.equal(httpStatusToExit(429), EXIT.RATE_LIMIT);
  });

  it('maps gateway timeout to network', () => {
    assert.equal(httpStatusToExit(504), EXIT.NETWORK);
  });

  it('maps 5xx to server', () => {
    assert.equal(httpStatusToExit(500), EXIT.SERVER);
    assert.equal(httpStatusToExit(502), EXIT.SERVER);
    assert.equal(httpStatusToExit(503), EXIT.SERVER);
  });

  it('maps 2xx to ok', () => {
    assert.equal(httpStatusToExit(200), EXIT.OK);
    assert.equal(httpStatusToExit(201), EXIT.OK);
    assert.equal(httpStatusToExit(204), EXIT.OK);
  });

  it('maps unknown and invalid statuses to server', () => {
    assert.equal(httpStatusToExit(418), EXIT.SERVER);
    assert.equal(httpStatusToExit(302), EXIT.SERVER);
    assert.equal(httpStatusToExit(undefined), EXIT.SERVER);
    assert.equal(httpStatusToExit(NaN), EXIT.SERVER);
  });
});

describe('errorCodeToExit', () => {
  it('maps auth codes', () => {
    assert.equal(errorCodeToExit('unauthorized'), EXIT.AUTH);
    assert.equal(errorCodeToExit('invalid_api_key'), EXIT.AUTH);
    assert.equal(errorCodeToExit('UNAUTHENTICATED'), EXIT.AUTH);
  });

  it('maps forbidden codes', () => {
    assert.equal(errorCodeToExit('forbidden'), EXIT.FORBIDDEN);
    assert.equal(errorCodeToExit('insufficient_scope'), EXIT.FORBIDDEN);
  });

  it('maps not-found codes', () => {
    assert.equal(errorCodeToExit('not_found'), EXIT.NOT_FOUND);
    assert.equal(errorCodeToExit('no_such_project'), EXIT.NOT_FOUND);
    assert.equal(errorCodeToExit('no_such_job'), EXIT.NOT_FOUND);
  });

  it('maps conflict codes', () => {
    assert.equal(errorCodeToExit('conflict'), EXIT.CONFLICT);
    assert.equal(errorCodeToExit('idempotency_conflict'), EXIT.CONFLICT);
  });

  it('maps rate-limit codes', () => {
    assert.equal(errorCodeToExit('rate_limited'), EXIT.RATE_LIMIT);
    assert.equal(errorCodeToExit('too_many_requests'), EXIT.RATE_LIMIT);
  });

  it('maps credit and payment codes', () => {
    assert.equal(errorCodeToExit('payment_required'), EXIT.PAYMENT);
    assert.equal(errorCodeToExit('credit_insufficient'), EXIT.PAYMENT);
    assert.equal(errorCodeToExit('insufficient_funds'), EXIT.PAYMENT);
  });

  it('maps validation codes', () => {
    assert.equal(errorCodeToExit('validation_error'), EXIT.VALIDATION);
    assert.equal(errorCodeToExit('schema_error'), EXIT.VALIDATION);
    assert.equal(errorCodeToExit('bad_request'), EXIT.VALIDATION);
    assert.equal(errorCodeToExit('payload_too_large'), EXIT.VALIDATION);
    assert.equal(errorCodeToExit('ambiguous_name'), EXIT.VALIDATION);
  });

  it('returns undefined for unknown or missing codes', () => {
    assert.equal(errorCodeToExit('something_else_entirely'), undefined);
    assert.equal(errorCodeToExit(undefined), undefined);
    assert.equal(errorCodeToExit(null), undefined);
    assert.equal(errorCodeToExit(123), undefined);
  });
});

describe('ApiError exit mapping', () => {
  it('prefers HTTP status when present', () => {
    const err = new ApiError({ status: 404, code: 'validation_error', message: 'nf' });
    assert.equal(err.exitCode, EXIT.NOT_FOUND);
  });

  it('refines server statuses with the error code', () => {
    const err = new ApiError({ status: 500, code: 'credit_insufficient', message: 'credit' });
    assert.equal(err.exitCode, EXIT.PAYMENT);
  });

  it('falls back to the error code without a status', () => {
    const err = new ApiError({ status: undefined, code: 'not_found', message: 'x' });
    assert.equal(err.exitCode, EXIT.NOT_FOUND);
  });

  it('falls back to server for unknown failures', () => {
    const err = new ApiError({ status: undefined, code: undefined, message: 'boom' });
    assert.equal(err.exitCode, EXIT.SERVER);
  });
});

describe('NetworkError', () => {
  it('always maps to network exit', () => {
    const err = new NetworkError('dns failed');
    assert.equal(err.exitCode, EXIT.NETWORK);
    assert.equal(err.retryable, true);
  });
});
