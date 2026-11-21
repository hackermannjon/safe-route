import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { useTripStore } from '../stores';

afterEach(() => {
  cleanup();
  // The store is a module singleton; without this a plan from one test leaks into the next.
  useTripStore.getState().reset();
});
