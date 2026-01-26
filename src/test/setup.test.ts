/**
 * @fileoverview Test to verify the test setup is working correctly.
 * This test file validates that all mocks and configurations are properly initialized.
 *
 * @module test/setup.test
 */

import { describe, it, expect, vi } from 'vitest';

// ============================================================================
// Setup Verification Tests
// ============================================================================

describe('Test Setup', () => {
  describe('Vitest Globals', () => {
    it('should have describe, it, expect available globally', () => {
      expect(typeof describe).toBe('function');
      expect(typeof it).toBe('function');
      expect(typeof expect).toBe('function');
    });

    it('should have vi mock utilities available', () => {
      expect(typeof vi.fn).toBe('function');
      expect(typeof vi.mock).toBe('function');
    });
  });

  describe('DOM Environment', () => {
    it('should have document available', () => {
      expect(typeof document).toBe('object');
      expect(document.createElement).toBeDefined();
    });

    it('should have window available', () => {
      expect(typeof window).toBe('object');
    });
  });

  describe('Browser API Mocks', () => {
    it('should have matchMedia mocked', () => {
      expect(typeof window.matchMedia).toBe('function');
      const mediaQuery = window.matchMedia('(min-width: 768px)');
      expect(mediaQuery.matches).toBe(false);
      expect(mediaQuery.media).toBe('(min-width: 768px)');
    });

    it('should have ResizeObserver mocked', () => {
      expect(typeof ResizeObserver).toBe('function');
      const observer = new ResizeObserver(() => {});
      expect(observer.observe).toBeDefined();
      expect(observer.unobserve).toBeDefined();
      expect(observer.disconnect).toBeDefined();
    });

    it('should have IntersectionObserver mocked', () => {
      expect(typeof IntersectionObserver).toBe('function');
      const observer = new IntersectionObserver(() => {});
      expect(observer.observe).toBeDefined();
      expect(observer.unobserve).toBeDefined();
      expect(observer.disconnect).toBeDefined();
    });

    it('should have scrollTo mocked', () => {
      expect(typeof window.scrollTo).toBe('function');
      // Should not throw
      window.scrollTo(0, 0);
    });
  });

  describe('IndexedDB Mock', () => {
    it('should have IndexedDB available', () => {
      expect(typeof indexedDB).toBe('object');
      expect(indexedDB.open).toBeDefined();
    });

    it('should be able to import and use the database', async () => {
      const { db } = await import('@/lib/db/database');
      expect(db).toBeDefined();
      expect(db.trips).toBeDefined();
      expect(db.rooms).toBeDefined();
      expect(db.persons).toBeDefined();
    });
  });

  describe('Testing Library Matchers', () => {
    it('should have extended matchers from jest-dom', () => {
      const div = document.createElement('div');
      div.textContent = 'Hello';
      document.body.appendChild(div);

      expect(div).toBeInTheDocument();
      expect(div).toHaveTextContent('Hello');
      expect(div).toBeVisible();

      document.body.removeChild(div);
    });
  });

  describe('i18n Mock', () => {
    it('should return translation keys directly', async () => {
      const { useTranslation } = await import('react-i18next');
      const { t } = useTranslation();

      expect(t('common.save')).toBe('common.save');
      expect(t('trips.title')).toBe('trips.title');
    });
  });
});
