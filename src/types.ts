/**
 * 微信开放平台第三方平台 API 接口类型定义
 */

/** 第三方平台配置 */
export interface ComponentConfig {
  /** 第三方平台 appid */
  appid: string;
  /** 第三方平台 appsecret */
  appsecret: string;
  /** 第三方平台 token（用于消息校验） */
  token?: string;
  /** 第三方平台 encodingAESKey（用于消息加解密） */
  encodingAESKey?: string;
}

/** Component Access Token */
export interface ComponentAccessToken {
  /** 第三方平台 access_token */
  accessToken: string;
  /** 过期时间戳（毫秒） */
  expireTime: number;
}

/** 授权方 Access Token */
export interface AuthorizerAccessToken extends ComponentAccessToken {
  /** 刷新令牌 */
  refreshToken: string;
}

/** 预授权码响应 */
export interface PreAuthCodeResult {
  pre_auth_code: string;
  expires_in: number;
}

/** 授权信息 */
export interface AuthorizationInfo {
  authorizer_appid: string;
  authorizer_access_token: string;
  expires_in: number;
  authorizer_refresh_token: string;
  func_info?: Array<{
    funcscope_category: {
      id: number;
    };
  }>;
}

/** 查询授权响应 */
export interface QueryAuthResult {
  authorization_info: AuthorizationInfo;
}

/** 刷新 Token 响应 */
export interface RefreshTokenResult {
  authorizer_access_token: string;
  expires_in: number;
  authorizer_refresh_token: string;
}

/** 授权方信息 */
export interface AuthorizerInfo {
  nick_name: string;
  head_img: string;
  service_type_info: { id: number };
  verify_type_info: { id: number };
  user_name: string;
  principal_name: string;
  alias?: string;
  business_info?: Record<string, number>;
  qrcode_url?: string;
  signature?: string;
  miniprograminfo?: {
    network?: {
      RequestDomain?: string[];
      WsRequestDomain?: string[];
      UploadDomain?: string[];
      DownloadDomain?: string[];
    };
    categories?: Array<{
      first: string;
      second: string;
    }>;
    visit_status?: number;
  };
}

/** 获取授权方信息响应 */
export interface GetAuthorizerInfoResult {
  authorizer_info: AuthorizerInfo;
  authorization_info: AuthorizationInfo;
}

/** 授权方选项值 */
export interface AuthorizerOptionResult {
  authorizer_appid: string;
  option_name: string;
  option_value: string;
}

/** OAuth Access Token */
export interface OAuthAccessToken {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  openid: string;
  scope: string;
  unionid?: string;
}

/** 用户信息 */
export interface UserInfo {
  openid: string;
  nickname: string;
  sex: number;
  province: string;
  city: string;
  country: string;
  headimgurl: string;
  privilege: string[];
  unionid?: string;
}

/** Token 存取回调函数类型 */
export type GetComponentTokenFn = () => Promise<ComponentAccessToken | null>;
export type SaveComponentTokenFn = (token: ComponentAccessToken) => Promise<void>;
export type GetComponentTicketFn = () => Promise<string>;

/** 微信 API 错误响应 */
export interface WechatApiError {
  errcode: number;
  errmsg: string;
}

/** 微信 API 响应基类 */
export type WechatApiResult<T> = T | WechatApiError;

/** 检查是否为错误响应 */
export function isWechatError(result: unknown): result is WechatApiError {
  return (
    typeof result === 'object' &&
    result !== null &&
    'errcode' in result &&
    (result as WechatApiError).errcode !== 0
  );
}
