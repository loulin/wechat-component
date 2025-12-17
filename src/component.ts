import {
  isWechatError,
  type ComponentConfig,
  type ComponentAccessToken,
  type PreAuthCodeResult,
  type QueryAuthResult,
  type RefreshTokenResult,
  type GetAuthorizerInfoResult,
  type AuthorizerOptionResult,
  type OAuthAccessToken,
  type GetComponentTokenFn,
  type SaveComponentTokenFn,
  type GetComponentTicketFn,
  type WechatApiError,
} from './types.js';

const API_PREFIX = 'https://api.weixin.qq.com/cgi-bin/component/';
const OAUTH_PREFIX = 'https://api.weixin.qq.com/sns/oauth2/component/';

/** 网络延迟缓冲时间（秒） */
const TOKEN_BUFFER_SECONDS = 10;

/**
 * 微信开放平台第三方平台 SDK
 *
 * 用于处理第三方平台的授权和 API 调用
 */
export class WechatComponent {
  private readonly appid: string;
  private readonly appsecret: string;
  private readonly getComponentTicket: GetComponentTicketFn;
  private readonly getToken: GetComponentTokenFn;
  private readonly saveToken: SaveComponentTokenFn;

  private cachedToken: ComponentAccessToken | null = null;

  constructor(
    config: ComponentConfig,
    options: {
      getComponentTicket: GetComponentTicketFn;
      getToken?: GetComponentTokenFn;
      saveToken?: SaveComponentTokenFn;
    }
  ) {
    if (!config.appid || !config.appsecret) {
      throw new Error('Missing required config: appid and appsecret');
    }

    this.appid = config.appid;
    this.appsecret = config.appsecret;
    this.getComponentTicket = options.getComponentTicket;

    // 默认使用内存存储（开发环境）
    this.getToken =
      options.getToken ||
      (async () => this.cachedToken);

    this.saveToken =
      options.saveToken ||
      (async (token) => {
        this.cachedToken = token;
        if (process.env.NODE_ENV === 'production') {
          console.warn(
            "[wechat-component] Don't save component token in memory in production!"
          );
        }
      });
  }

  /**
   * 发起 HTTP 请求
   */
  private async request<T>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as T | WechatApiError;

    if (isWechatError(data)) {
      throw new Error(`Wechat API Error: ${data.errcode} - ${data.errmsg}`);
    }

    return data as T;
  }

  /**
   * 检查 token 是否有效
   */
  private isTokenValid(token: ComponentAccessToken | null): boolean {
    if (!token) return false;
    return Date.now() < token.expireTime;
  }

  /**
   * 计算 token 过期时间
   */
  private calculateExpireTime(expiresIn: number): number {
    return Date.now() + (expiresIn - TOKEN_BUFFER_SECONDS) * 1000;
  }

  /**
   * 获取第三方平台 component_access_token
   *
   * 会自动处理缓存和过期刷新
   */
  async getAccessToken(): Promise<ComponentAccessToken> {
    // 尝试从缓存获取
    let token = await this.getToken();

    if (this.isTokenValid(token)) {
      return token!;
    }

    // 获取 component_verify_ticket
    const ticket = await this.getComponentTicket();

    if (!ticket) {
      throw new Error('Component verify ticket is not available');
    }

    // 请求新的 access_token
    const result = await this.request<{
      component_access_token: string;
      expires_in: number;
    }>(`${API_PREFIX}api_component_token`, {
      method: 'POST',
      body: JSON.stringify({
        component_appid: this.appid,
        component_appsecret: this.appsecret,
        component_verify_ticket: ticket,
      }),
    });

    token = {
      accessToken: result.component_access_token,
      expireTime: this.calculateExpireTime(result.expires_in),
    };

    await this.saveToken(token);

    return token;
  }

  /**
   * 确保有有效的 access_token 后执行操作
   */
  private async withAccessToken<T>(
    fn: (accessToken: string) => Promise<T>
  ): Promise<T> {
    const token = await this.getAccessToken();
    return fn(token.accessToken);
  }

  /**
   * 创建预授权码
   */
  async createPreAuthCode(): Promise<PreAuthCodeResult> {
    return this.withAccessToken(async (accessToken) => {
      return this.request<PreAuthCodeResult>(
        `${API_PREFIX}api_create_preauthcode?component_access_token=${accessToken}`,
        {
          method: 'POST',
          body: JSON.stringify({
            component_appid: this.appid,
          }),
        }
      );
    });
  }

  /**
   * 获取授权页面 URL
   *
   * @param redirectUri - 授权后回调地址
   * @param preAuthCode - 预授权码（可选，如不提供会自动创建）
   */
  async getAuthorizeURL(
    redirectUri: string,
    preAuthCode?: string
  ): Promise<string> {
    const code = preAuthCode || (await this.createPreAuthCode()).pre_auth_code;

    return (
      `https://mp.weixin.qq.com/cgi-bin/componentloginpage?` +
      `component_appid=${this.appid}&` +
      `pre_auth_code=${code}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}`
    );
  }

  /**
   * 使用授权码换取授权信息
   *
   * @param authCode - 授权成功后回调的 authorization_code
   */
  async queryAuth(authCode: string): Promise<QueryAuthResult> {
    return this.withAccessToken(async (accessToken) => {
      return this.request<QueryAuthResult>(
        `${API_PREFIX}api_query_auth?component_access_token=${accessToken}`,
        {
          method: 'POST',
          body: JSON.stringify({
            component_appid: this.appid,
            authorization_code: authCode,
          }),
        }
      );
    });
  }

  /**
   * 刷新授权方的 access_token
   *
   * @param authorizerAppid - 授权方 appid
   * @param refreshToken - 刷新令牌
   */
  async getAuthorizerToken(
    authorizerAppid: string,
    refreshToken: string
  ): Promise<RefreshTokenResult> {
    return this.withAccessToken(async (accessToken) => {
      return this.request<RefreshTokenResult>(
        `${API_PREFIX}api_authorizer_token?component_access_token=${accessToken}`,
        {
          method: 'POST',
          body: JSON.stringify({
            component_appid: this.appid,
            authorizer_appid: authorizerAppid,
            authorizer_refresh_token: refreshToken,
          }),
        }
      );
    });
  }

  /**
   * 获取授权方的账号信息
   *
   * @param authorizerAppid - 授权方 appid
   */
  async getAuthorizerInfo(
    authorizerAppid: string
  ): Promise<GetAuthorizerInfoResult> {
    return this.withAccessToken(async (accessToken) => {
      return this.request<GetAuthorizerInfoResult>(
        `${API_PREFIX}api_get_authorizer_info?component_access_token=${accessToken}`,
        {
          method: 'POST',
          body: JSON.stringify({
            component_appid: this.appid,
            authorizer_appid: authorizerAppid,
          }),
        }
      );
    });
  }

  /**
   * 获取授权方选项信息
   *
   * @param authorizerAppid - 授权方 appid
   * @param optionName - 选项名称
   */
  async getAuthorizerOption(
    authorizerAppid: string,
    optionName: string
  ): Promise<AuthorizerOptionResult> {
    return this.withAccessToken(async (accessToken) => {
      return this.request<AuthorizerOptionResult>(
        `${API_PREFIX}api_get_authorizer_option?component_access_token=${accessToken}`,
        {
          method: 'POST',
          body: JSON.stringify({
            component_appid: this.appid,
            authorizer_appid: authorizerAppid,
            option_name: optionName,
          }),
        }
      );
    });
  }

  /**
   * 设置授权方选项信息
   *
   * @param authorizerAppid - 授权方 appid
   * @param optionName - 选项名称
   * @param optionValue - 选项值
   */
  async setAuthorizerOption(
    authorizerAppid: string,
    optionName: string,
    optionValue: string
  ): Promise<void> {
    await this.withAccessToken(async (accessToken) => {
      await this.request<{ errcode: number; errmsg: string }>(
        `${API_PREFIX}api_set_authorizer_option?component_access_token=${accessToken}`,
        {
          method: 'POST',
          body: JSON.stringify({
            component_appid: this.appid,
            authorizer_appid: authorizerAppid,
            option_name: optionName,
            option_value: optionValue,
          }),
        }
      );
    });
  }

  // ============ OAuth 相关方法 ============

  /**
   * 获取第三方平台代公众号 OAuth 授权 URL
   *
   * @param authorizerAppid - 授权方 appid
   * @param redirectUri - 授权后回调地址
   * @param scope - 授权作用域 (snsapi_base 或 snsapi_userinfo)
   * @param state - 自定义状态参数
   */
  getOAuthAuthorizeURL(
    authorizerAppid: string,
    redirectUri: string,
    scope: 'snsapi_base' | 'snsapi_userinfo' = 'snsapi_base',
    state = ''
  ): string {
    const params = new URLSearchParams({
      appid: authorizerAppid,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope,
      state,
      component_appid: this.appid,
    });

    return `https://open.weixin.qq.com/connect/oauth2/authorize?${params}#wechat_redirect`;
  }

  /**
   * 通过 code 获取 OAuth access_token
   *
   * @param authorizerAppid - 授权方 appid
   * @param code - 用户授权后获得的 code
   */
  async getOAuthAccessToken(
    authorizerAppid: string,
    code: string
  ): Promise<OAuthAccessToken> {
    return this.withAccessToken(async (componentAccessToken) => {
      const params = new URLSearchParams({
        appid: authorizerAppid,
        code,
        grant_type: 'authorization_code',
        component_appid: this.appid,
        component_access_token: componentAccessToken,
      });

      return this.request<OAuthAccessToken>(
        `${OAUTH_PREFIX}access_token?${params}`
      );
    });
  }

  /**
   * 刷新 OAuth access_token
   *
   * @param authorizerAppid - 授权方 appid
   * @param refreshToken - refresh_token
   */
  async refreshOAuthAccessToken(
    authorizerAppid: string,
    refreshToken: string
  ): Promise<OAuthAccessToken> {
    return this.withAccessToken(async (componentAccessToken) => {
      const params = new URLSearchParams({
        appid: authorizerAppid,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        component_appid: this.appid,
        component_access_token: componentAccessToken,
      });

      return this.request<OAuthAccessToken>(
        `${OAUTH_PREFIX}refresh_token?${params}`
      );
    });
  }
}

export default WechatComponent;
