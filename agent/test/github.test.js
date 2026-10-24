import test from 'node:test';
import assert from 'node:assert/strict';
import { explainGithubWriteError } from '../src/github.js';

test('403 write errors explain fine-grained token access and permissions', () => {
  const message = explainGithubWriteError({ status: 403 }, 'owner/repo');

  assert.match(message, /owner\/repo/);
  assert.match(message, /exact repository/);
  assert.match(message, /Contents: Read and write/);
  assert.match(message, /Pull requests: Read and write/);
  assert.match(message, /SSO/);
});

test('401 errors tell the user to replace the rejected token', () => {
  assert.match(explainGithubWriteError({ status: 401 }), /Replace the project's GitHub token/);
});

test('404 errors point to repository, access, and base branch settings', () => {
  const message = explainGithubWriteError({ status: 404 });

  assert.match(message, /repository name/);
  assert.match(message, /base branch/);
});

test('other errors preserve the provider diagnostic', () => {
  assert.equal(explainGithubWriteError({ status: 422, message: 'Validation failed' }), 'Validation failed');
});
