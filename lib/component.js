'use strict';

var util = require('./util');
var urllib = require('urllib');
var wrapper = util.wrapper;
var postJSON = util.postJSON;
var make = util.make;
var extend = require('util')._extend;

var AccessToken = function(data) {
  if (!(this instanceof AccessToken)) {
    return new AccessToken(data);
  }
  this.data = data;
};

function mapToken(accessToken, expiresIn, refreshToken) {
  // 过期时间，因网络延迟等，将实际过期时间提前10秒，以防止临界点
  var expireTime = (new Date().getTime()) + (expiresIn - 10) * 1000;
  var token = AccessToken(accessToken, expireTime);
  if (refreshToken) {
    token.refreshToken = refreshToken;
  }
  return token;
}

var Component = function(appid, appsecret, getComponentTicket, getToken, saveToken) {
  this.appid = appid;
  this.appsecret = appsecret;
  this.getComponentTicket = getComponentTicket;
  this.getToken = getToken || function(callback) {
    callback(null, this.token);
  };

  this.saveToken = saveToken || function(token, callback) {
    this.token = token;
    if (process.env.NODE_ENV === 'production') {
      console.warn('Don\'t save component token in memory, when cluster or multi-computer!');
    }

    callback(null);
  };
  this.prefix = 'https://api.weixin.qq.com/cgi-bin/component/';
};

Component.prototype.getAccessToken = function(callback) {
  var that = this;
  this.getComponentTicket(function(err, ticket) {
    if (err) {
      return callback(err);
    }

    that.request(that.prefix + 'api_component_token', postJSON({
      component_appid: that.appid,
      component_appsecret: that.appsecret,
      component_verify_ticket: ticket
    }), wrapper(function(err, data) {
      if (err) {
        return callback(err);
      }

      var token = mapToken(data.component_access_token, data.expires_in);
      that.saveToken(token, function(err) {
        if (err) {
          return callback(err);
        }

        callback(err, token);
      });
    }));
  });
  return this;
};

Component.prototype.preRequest = function(method, args, retryed) {
  var that = this;
  var callback = args[args.length - 1];
  // 调用用户传入的获取token的异步方法，获得token之后使用（并缓存它）。
  that.getToken(function(err, token) {
    if (err) {
      return callback(err);
    }
    var accessToken;
    // 有token并且token有效直接调用
    if (!retryed && token && (accessToken = AccessToken(token.accessToken, token.expireTime)).isValid()) {
      // 暂时保存token
      that.token = accessToken;
      var retryHandle = function(err, data, res) {
        // 40001 重试
        if (data && data.errcode && data.errcode === 40001) {
          return that.preRequest(method, args, true);
        }
        callback(err, data, res);
      };
      // 替换callback
      var newargs = Array.prototype.slice.call(args, 0, -1);
      newargs.push(retryHandle);
      method.apply(that, newargs);
    } else {
      // 使用appid/appsecret获取token
      that.getAccessToken(function(err, token) {
        // 如遇错误，通过回调函数传出
        if (err) {
          return callback(err);
        }
        // 暂时保存token
        that.token = token;
        method.apply(that, args);
      });
    }
  });
};

make(Component.prototype, 'createPreAuthCode', function(callback) {
  this.request(this.prefix + 'api_create_preauthcode?component_access_token=' + this.token.accessToken, postJSON({
    component_appid: this.appid
  }), wrapper(callback));
});

Component.prototype._getAuthorizeURL = function(preAuthCode, redirectURI) {
  return 'https://mp.weixin.qq.com/cgi-bin/componentloginpage?component_appid=' + this.appid + '&pre_auth_code=' + preAuthCode + '&redirect_uri=' + redirectURI;
};

Component.prototype.getAuthorizeURL = function(redirectURI, callback) {
  var that = this;
  this.createPreAuthCode(function(err, result) {
    if (err) {
      return callback(err);
    }
    callback(null, that._getAuthorizeURL(result.pre_auth_code, redirectURI));
  });
};

make(Component.prototype, 'queryAuth', function(authCode, callback) {
  this.request(this.prefix + 'api_query_auth?component_access_token=' + this.token.accessToken, postJSON({
    component_appid: this.appid,
    authorization_code: authCode
  }), wrapper(callback));
});

make(Component.prototype, 'getAuthorizerToken', function(authorizerAppid, refreshToken, callback) {
  this.request(this.prefix + 'api_authorizer_token?component_access_token=' + this.token.accessToken, postJSON({
    component_appid: this.appid,
    authorizer_appid: authorizerAppid,
    authorizer_refresh_token: refreshToken
  }), wrapper(callback));
});

make(Component.prototype, 'getAuthorizerInfo', function(authorizerAppid, callback) {
  this.request(this.prefix + 'api_get_authorizer_info?component_access_token=' + this.token.accessToken, postJSON({
    component_appid: this.appid,
    authorizer_appid: authorizerAppid
  }), wrapper(callback));
});

make(Component.prototype, 'getAuthorizerOption', function(authorizerAppid, optionName, callback) {
  this.request(this.prefix + 'api_get_authorizer_option?component_access_token=' + this.token.accessToken, postJSON({
    component_appid: this.appid,
    authorizer_appid: authorizerAppid,
    option_name: optionName
  }), wrapper(callback));
});

make(Component.prototype, 'setAuthorizerOption', function(authorizerAppid, optionName, optionValue, callback) {
  this.request(this.prefix + 'api_set_authorizer_option?component_access_token=' + this.token.accessToken, postJSON({
    component_appid: this.appid,
    authorizer_appid: authorizerAppid,
    option_name: optionName,
    option_value: optionValue
  }), wrapper(callback));
});

Component.prototype.warpAPI = function(api) {
  var component = this;

  api._getAccessToken = function(callback) {
    api.getToken(function(err, token) {
      if (err) {
        return callback(err);
      }

      component.getAuthorizerToken(api.appid, token.refreshToken, function(err, data) {
        if (err) {
          return callback(err);
        }

        var token = mapToken(data.authorizer_access_token, data.expires_in, data.authorizer_refresh_token);
        api.saveToken(token, function(err) {
          if (err) {
            return callback(err);
          }

          callback(null, token);
        });
      });
    });
  };

  api.getAccessToken = function() {
    component.preRequest(api._getAccessToken, arguments);
  };

  return api;
};

/**
 * 获取oauth认证的API
 * @param appid
 * @param getToken
 * @param saveToken
 */
Component.prototype.wrapOAuth = function(oauth) {
  var component = this;

  var processToken = function(that, callback) {
    return function(err, data, res) {
      if (err) {
        return callback(err, data);
      }
      data.create_at = new Date().getTime();
      // 存储token
      oauth.saveToken(data.openid, data, function(err) {
        callback(err, AccessToken(data));
      });
    };
  };

  var _getAuthorizeURL = oauth.getAuthorizeURL;
  /**
   * 重写获得oauth认证地址的处理
   * @param redirect
   * @param state
   * @param scope
   * @returns {void|XML|string}
   */
  oauth.getAuthorizeURL = function(redirect, state, scope) {
    return _getAuthorizeURL.apply(oauth, arguments).replace('#wechat_redirect', '&component_appid=' + component.appid + '#wechat_redirect');
  };
  var _getAccessToken = function(code, callback) {
    var that = this;
    var url = 'https://api.weixin.qq.com/sns/oauth2/component/access_token';
    var info = {
      appid: oauth.appid,
      code: code,
      grant_type: 'authorization_code',
      component_appid: component.appid,
      component_access_token: component.token.accessToken
    };
    var args = {
      data: info,
      dataType: 'json'
    };
    that.request(url, args, wrapper(processToken(that, callback)));
  };
  /**
   * 重写获得用户授权Token的处理
   */
  oauth.getAccessToken = function() {
    component.preRequest(_getAccessToken, arguments);
  };
  var _refreshAccessToken = function(refreshToken, callback) {
    var that = this;
    var url = 'https://api.weixin.qq.com/sns/oauth2/component/refresh_token';
    var info = {
      appid: oauth.appid,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      component_appid: component.appid,
      component_access_token: component.token.accessToken
    };
    var args = {
      data: info,
      dataType: 'json'
    };
    that.request(url, args, wrapper(processToken(that, callback)));
  };
  /**
   * 重写刷新用户授权Token的处理
   * @param refreshToken
   * @param callback
   */
  oauth.refreshAccessToken = function(refreshToken, callback) {
    component.preRequest(_refreshAccessToken, arguments);
  };

  return oauth;
};

Component.prototype.request = function(url, opts, callback) {
  var options = {};
  extend(options, this.defaults);
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  for (var key in opts) {
    if (key !== 'headers') {
      options[key] = opts[key];
    } else {
      if (opts.headers) {
        options.headers = options.headers || {};
        extend(options.headers, opts.headers);
      }
    }
  }
  urllib.request(url, options, callback);
};

module.exports = Component;
