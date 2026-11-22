import assert from 'node:assert/strict';
import test from 'node:test';
import { fieldsCount, isFew, plural } from './plural.js';

test('forma „kilka” dla 2–4, ale nie dla 12–14', () => {
  assert.deepEqual([1, 2, 4, 5, 12, 14, 22, 25, 104, 112].map(isFew),
    [false, true, true, false, false, false, true, false, true, false]);
});

test('trzy formy słowa', () => {
  const word = (n) => plural(n, 'warstwa', 'warstwy', 'warstw');
  assert.deepEqual([1, 3, 5, 13, 23, 0].map(word), ['warstwa', 'warstwy', 'warstw', 'warstw', 'warstwy', 'warstw']);
  assert.equal(fieldsCount(1), '1 pole');
  assert.equal(fieldsCount(22), '22 pola');
  assert.equal(fieldsCount(12), '12 pól');
});
