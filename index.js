const util = require('util');
const request = require('request-promise');

function isTokenValid(token) {
  return token && token.accessToken && new Date().getTime() < token.expireTime;
}

function transform(body) {
  if (!body) {
    const err = new Error('No body received.');
    err.name = 'WechatAPIError';
    err.code = -1;
    throw err;
  }

  if (body.errcode) {
    const err = new Error(body.errmsg);
    err.name = 'WechatAPIError';
    err.code = body.errcode;
    throw err;
  }

  return body;
}

class Component {
  constructor({
    appid,
    appsecret,
    getComponentTicket,
    getComponentTicketAsync,
    getToken,
    getTokenAsync,
    saveToken,
    saveTokenAsync,
  }) {
    this.baseUrl = 'https://api.weixin.qq.com/cgi-bin/component';
    this.appid = appid;
    this.appsecret = appsecret;
    this.getComponentTicket = getComponentTicket;
    this.getComponentTicketAsync = getComponentTicketAsync || util.promisify(getComponentTicket);
    this.getToken = getToken || (callback => callback(null, this.token));
    this.getTokenAsync = getTokenAsync || util.promisify(this.getToken);
    this.saveToken = saveToken || ((token, callback) => {
      this.token = token;

      if (process.env.NODE_ENV === 'production') {
        console.warn('Don\'t save component token in memory, when cluster or multi-computer!');
      }

      return callback(null, token);
    });
    this.saveTokenAsync = saveTokenAsync || util.promisify(this.saveToken);
  }

  async getAccessToken(callback) {
    try {
      const ticket = await this.getComponentTicketAsync();
      const result = await request.post(`${this.baseUrl}/api_component_token`, {
        json: true,
        // transform, // will throw TransformError wrapping too much context
        body: {
          component_appid: this.appid,
          component_appsecret: this.appsecret,
          component_verify_ticket: ticket,
        },
      }).then(transform);

      const expireTime = new Date().getTime() + ((result.expires_in - 10) * 1000);
      const token = { accessToken: result.component_access_token, expireTime };

      await this.saveTokenAsync(token);

      return callback ? callback(null, token) : token;
    } catch (e) {
      return callback ? callback(e) : Promise.reject(e);
    }
  }

  async request(options, callback, retried) {
    try {
      // 方案1，若缓存token失效(非过期)，则retry无用，只能等到token过期
      // let token = await this.getTokenAsync();
      // if (!isTokenValid(token)) token = await this.getAccessToken();

      // 方案2，若token失效(非过期)则在retry时直接请求token
      let token = !retried && await this.getTokenAsync();

      if (retried || !isTokenValid(token)) token = await this.getAccessToken();

      const accessTokenKey = options.accessTokenKey || 'component_access_token';
      const result = await request({
        baseUrl: this.baseUrl,
        method: 'POST',
        json: true,
        // transform,
        ...options,
        qs: { [accessTokenKey]: token.accessToken, ...options.qs },
      }).then(transform);

      if (!retried && result && result.errcode === 40001) {
        return this.request(options, callback, true);
      }

      return callback ? callback(null, result) : result;
    } catch (e) {
      return callback ? callback(e) : Promise.reject(e);
    }
  }

  async createPreAuthCode(callback) {
    return this.request({
      uri: '/api_create_preauthcode',
      body: { component_appid: this.appid },
    }, callback);
  }

  async getAuthorizeURL(redirectURI, authType, done) {
    let type = authType;
    let callback = done;

    if (!authType || typeof authType === 'function') {
      type = 3;
      callback = authType;
    }

    try {
      const result = await this.createPreAuthCode();
      const authorizeURL = `https://mp.weixin.qq.com/cgi-bin/componentloginpage?component_appid=${this.appid}&pre_auth_code=${result.pre_auth_code}&redirect_uri=${redirectURI}&auth_type=${type}`;

      return callback ? callback(null, authorizeURL) : authorizeURL;
    } catch (e) {
      return callback ? callback(e) : Promise.reject(e);
    }
  }

  async queryAuth(authCode, callback) {
    return this.request({
      uri: '/api_query_auth',
      body: {
        component_appid: this.appid,
        authorization_code: authCode,
      },
    }, callback);
  }

  async getAuthorizerToken(authorizerAppid, refreshToken, callback) {
    return this.request({
      uri: '/api_authorizer_token',
      body: {
        component_appid: this.appid,
        authorizer_appid: authorizerAppid,
        authorizer_refresh_token: refreshToken,
      },
    }, callback);
  }

  async getAuthorizerInfo(authorizerAppid, callback) {
    return this.request({
      uri: '/api_get_authorizer_info',
      body: {
        component_appid: this.appid,
        authorizer_appid: authorizerAppid,
      },
    }, callback);
  }

  async getAuthorizerOption(authorizerAppid, optionName, callback) {
    return this.request({
      uri: '/api_get_authorizer_option',
      body: {
        component_appid: this.appid,
        authorizer_appid: authorizerAppid,
        option_name: optionName,
      },
    }, callback);
  }

  async setAuthorizerOption(authorizerAppid, optionName, optionValue, callback) {
    return this.request({
      uri: '/api_set_authorizer_option',
      body: {
        component_appid: this.appid,
        authorizer_appid: authorizerAppid,
        option_name: optionName,
        option_value: optionValue,
      },
    }, callback);
  }

  async clearQuota(callback) {
    return this.request({
      uri: '/clear_quota',
      body: { component_appid: this.appid },
    }, callback);
  }

  // 代公众号发起网页授权
  getOAuthAuthorizeURL(authorizerAppid, redirectURI, scope = 'snsapi_base', state = '') {
    return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${authorizerAppid}&redirect_uri=${redirectURI}&response_type=code&scope=${scope}&state=${state}&component_appid=${this.appid}#wechat_redirect`;
  }

  async getOAuthAccessToken(authorizerAppid, code, callback) {
    return this.request({
      baseUrl: 'https://api.weixin.qq.com/sns/oauth2/component',
      uri: '/access_token',
      method: 'GET',
      qs: {
        component_appid: this.appid,
        appid: authorizerAppid,
        code,
        grant_type: 'authorization_code',
      },
    }, callback);
  }

  async refreshOAuthAccessToken(authorizerAppid, refreshToken, callback) {
    return this.request({
      baseUrl: 'https://api.weixin.qq.com/sns/oauth2/component',
      uri: '/refresh_token',
      method: 'GET',
      qs: {
        component_appid: this.appid,
        appid: authorizerAppid,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
    }, callback);
  }

  // 小程序微信登录
  async jscode2session(authorizerAppid, code, callback) {
    return this.request({
      baseUrl: 'https://api.weixin.qq.com/sns/component/',
      uri: '/jscode2session',
      method: 'GET',
      qs: {
        component_appid: this.appid,
        appid: authorizerAppid,
        js_code: code,
        grant_type: 'authorization_code',
      },
    }, callback);
  }

  // 卡券第三方强授权接口
  async uploadCardAgentQualification(body, callback) {
    return this.request({
      uri: '/upload_card_agent_qualification',
      accessTokenKey: 'access_token',
      body,
    }, callback);
  }

  async checkCardAgentQualification(callback) {
    return this.request({
      uri: '/check_card_agent_qualification',
      accessTokenKey: 'access_token',
    }, callback);
  }

  async uploadCardMerchantQualification(body, callback) {
    return this.request({
      uri: '/upload_card_merchant_qualification',
      accessTokenKey: 'access_token',
      body,
    }, callback);
  }

  async checkCardMerchantQualification(body, callback) {
    return this.request({
      uri: '/check_card_merchant_qualification',
      accessTokenKey: 'access_token',
      body,
    }, callback);
  }

  async getCardMerchant(authorizerAppid, callback) {
    return this.request({
      uri: '/get_card_merchant',
      accessTokenKey: 'access_token',
      body: { appid: authorizerAppid },
    }, callback);
  }

  async batchGetCardMerchant(next, callback) {
    let nextzGet = next;
    let done = callback;

    if (typeof next === 'function') {
      nextzGet = '';
      done = next;
    }

    return this.request({
      uri: '/batchget_card_merchant',
      accessTokenKey: 'access_token',
      body: { next_get: nextzGet },
    }, done);
  }

  async confirmAuthorization(authorizerAppid, funscopeCategoryId, confirmValue, callback) {
    return this.request({
      uri: '/api_confirm_authorization',
      accessTokenKey: 'access_token',
      body: {
        component_appid: this.appid,
        authorizer_appid: authorizerAppid,
        funcscope_category_id: funscopeCategoryId,
        confirm_value: confirmValue,
      },
    }, callback);
  }
}

module.exports = Component;
