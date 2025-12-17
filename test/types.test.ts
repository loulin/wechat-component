import { describe, it, expect } from 'vitest';
import { isWechatError } from '../src/types';

describe('types', () => {
  describe('isWechatError', () => {
    it('should return true for error response', () => {
      const error = { errcode: 40001, errmsg: 'invalid credential' };
      expect(isWechatError(error)).toBe(true);
    });

    it('should return false for success response with errcode 0', () => {
      const success = { errcode: 0, errmsg: 'ok' };
      expect(isWechatError(success)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isWechatError(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isWechatError(undefined)).toBe(false);
    });

    it('should return false for normal response without errcode', () => {
      const response = { access_token: 'token', expires_in: 7200 };
      expect(isWechatError(response)).toBe(false);
    });
  });
});
