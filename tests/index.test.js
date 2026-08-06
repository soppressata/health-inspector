import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getInput } from '../src/index.js';

test('getInput maps dashed input names to INPUT_<NAME> env vars', () => {
  process.env['INPUT_API-KEY'] = 'sk-secret';
  process.env['INPUT_STATE-BRANCH'] = 'inspector-state';
  process.env['INPUT_MAX-CANDIDATES'] = '7';
  try {
    assert.equal(getInput('api-key'), 'sk-secret');
    assert.equal(getInput('state-branch'), 'inspector-state');
    assert.equal(getInput('max-candidates'), '7');
  } finally {
    delete process.env['INPUT_API-KEY'];
    delete process.env['INPUT_STATE-BRANCH'];
    delete process.env['INPUT_MAX-CANDIDATES'];
  }
});

test('getInput returns undefined for unset inputs', () => {
  delete process.env['INPUT_API-KEY'];
  assert.equal(getInput('api-key'), undefined);
});
