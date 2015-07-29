'use strict';

var util = require('./util');
var wrapper = util.wrapper;
var postJSON = util.postJSON;
var make = util.make;
var API = require('wechat-api');

// 微信API重试机制fix，accessToken失效时必须重新请求，防止多点请求accessToken失效
API.prototype.preRequest = function(method, args, retryed) {
  var that = this;
  var callback = args[args.length - 1];
  that.getToken(function(err, token) {
    if (err) {
      return callback(err);
    }
    var accessToken;
    if (!retryed && token && (accessToken = API.AccessToken(token.accessToken, token.expireTime, token.refreshToken)).isValid()) {
      that.token = accessToken;
      var retryHandle = function(err, data, res) {
        if (data && data.errcode && data.errcode === 40001) {
          return that.preRequest(method, args, true);
        }
        callback(err, data, res);
      };
      var newargs = Array.prototype.slice.call(args, 0, -1);
      newargs.push(retryHandle);
      method.apply(that, newargs);
    } else {
      that.getAccessToken(function(err, token) {
        if (err) {
          return callback(err);
        }
        that.token = token;
        method.apply(that, args);
      });
    }
  });
};

function mapToken(accessToken, expiresIn, refreshToken) {
  // 过期时间，因网络延迟等，将实际过期时间提前10秒，以防止临界点
  var expireTime = (new Date().getTime()) + (expiresIn - 10) * 1000;
  var token = API.AccessToken(accessToken, expireTime);
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
    if (token && (accessToken = API.AccessToken(token.accessToken, token.expireTime)).isValid()) {
      // 暂时保存token
      that.token = accessToken;
      if (!retryed) {
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
        method.apply(that, args);
      }
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

make(Component.prototype, 'queryAuth', function(authCode, callback) {
  this.request(this.prefix + 'api_query_auth?component_access_token=' + this.token.accessToken, postJSON({
    component_appid: this.appid,
    authorization_code: authCode
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

Component.prototype.getAPI = function(appid, getToken, saveToken) {
  if (!getToken) {
    throw new Error('getToken function must be specified to get refreshToken');
  }

  var component = this;
  var api = new API(appid, null, getToken, saveToken);

  api._getAccessToken = function(callback) {
    api.getToken(function(err, token) {
      if (err) {
        return callback(err);
      }

      api.request(component.prefix + 'api_authorizer_token?component_access_token=' + component.token.accessToken, postJSON({
        component_appid: component.appid,
        authorizer_appid: api.appid,
        authorizer_refresh_token: token.refreshToken
      }), wrapper(function(err, data) {
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
      }));
    });
    return api;
  };

  api.getAccessToken = function() {
    component.preRequest(api._getAccessToken, arguments);
  };

  return api;
};

Component.prototype.request = API.prototype.request;

module.exports = Component;
