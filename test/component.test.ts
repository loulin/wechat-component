import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WechatComponent } from '../src/component';
import type { ComponentAccessToken } from '../src/types';

describe('WechatComponent', () => {
  const mockConfig = {
    appid: 'test_appid',
    appsecret: 'test_appsecret',
    token: 'test_token',
  };

  const mockTicket = 'test_ticket_12345';

  describe('constructor', () => {
    it('should throw error if appid is missing', () => {
      expect(() => {
        new WechatComponent(
          { appid: '', appsecret: 'secret' },
          { getComponentTicket: async () => mockTicket }
        );
      }).toThrow('Missing required config');
    });

    it('should throw error if appsecret is missing', () => {
      expect(() => {
        new WechatComponent(
          { appid: 'appid', appsecret: '' },
          { getComponentTicket: async () => mockTicket }
        );
      }).toThrow('Missing required config');
    });

    it('should create instance with valid config', () => {
      const component = new WechatComponent(mockConfig, {
        getComponentTicket: async () => mockTicket,
      });
      expect(component).toBeInstanceOf(WechatComponent);
    });
  });

  describe('getOAuthAuthorizeURL', () => {
    it('should generate correct OAuth URL with default scope', () => {
      const component = new WechatComponent(mockConfig, {
        getComponentTicket: async () => mockTicket,
      });

      const url = component.getOAuthAuthorizeURL(
        'authorizer_appid',
        'https://example.com/callback'
      );

      expect(url).toContain('https://open.weixin.qq.com/connect/oauth2/authorize');
      expect(url).toContain('appid=authorizer_appid');
      expect(url).toContain('component_appid=test_appid');
      expect(url).toContain('scope=snsapi_base');
      expect(url).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback');
    });

    it('should generate correct OAuth URL with snsapi_userinfo scope', () => {
      const component = new WechatComponent(mockConfig, {
        getComponentTicket: async () => mockTicket,
      });

      const url = component.getOAuthAuthorizeURL(
        'authorizer_appid',
        'https://example.com/callback',
        'snsapi_userinfo',
        'custom_state'
      );

      expect(url).toContain('scope=snsapi_userinfo');
      expect(url).toContain('state=custom_state');
    });
  });

  describe('getAccessToken', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should fetch access token from API', async () => {
      const mockResponse = {
        component_access_token: 'mock_access_token',
        expires_in: 7200,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const component = new WechatComponent(mockConfig, {
        getComponentTicket: async () => mockTicket,
      });

      const token = await component.getAccessToken();

      expect(token.accessToken).toBe('mock_access_token');
      expect(token.expireTime).toBeGreaterThan(Date.now());
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('api_component_token'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should use cached token if still valid', async () => {
      const cachedToken: ComponentAccessToken = {
        accessToken: 'cached_token',
        expireTime: Date.now() + 3600000, // 1 hour from now
      };

      const component = new WechatComponent(mockConfig, {
        getComponentTicket: async () => mockTicket,
        getToken: async () => cachedToken,
      });

      const token = await component.getAccessToken();

      expect(token.accessToken).toBe('cached_token');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should throw error on API failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          errcode: 40001,
          errmsg: 'invalid credential',
        }),
      });

      const component = new WechatComponent(mockConfig, {
        getComponentTicket: async () => mockTicket,
      });

      await expect(component.getAccessToken()).rejects.toThrow('Wechat API Error');
    });
  });

  describe('createPreAuthCode', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should create pre auth code', async () => {
      // First mock for getAccessToken
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            component_access_token: 'mock_token',
            expires_in: 7200,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            pre_auth_code: 'mock_pre_auth_code',
            expires_in: 600,
          }),
        });

      const component = new WechatComponent(mockConfig, {
        getComponentTicket: async () => mockTicket,
      });

      const result = await component.createPreAuthCode();

      expect(result.pre_auth_code).toBe('mock_pre_auth_code');
      expect(result.expires_in).toBe(600);
    });
  });
});
