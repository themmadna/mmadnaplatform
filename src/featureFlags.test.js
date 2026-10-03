import { predictionsEnabled } from './featureFlags';

test('predictions are on only for allowlisted accounts', () => {
  expect(predictionsEnabled({ user: { id: '92ece4d5-d62d-48e3-988d-6d25c22152f2' } })).toBe(true);
  expect(predictionsEnabled({ user: { id: '00000000-0000-0000-0000-000000000000' } })).toBe(false);
  expect(predictionsEnabled(null)).toBe(false);   // guest / signed out
});
