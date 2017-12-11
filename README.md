# wechat-component

## Usage

### Basic
```js
const WechatComponent = require('wechat-component');

const component = new WechatComponent({
  appid: '<WECHAT_COMPONENT_APPID>',
  appsecret: '<WECHAT_COMPONENT_APPSECRET>',
  getComponentTicketAsync: async () => ... // get component ticket from cache/database;
  getTokenAsync: async () => ... // get access token from cache/database;
  saveTokenAsync: async token => ... // save access token to cache/database;
});

// Step 1
const authorizeURL = await component.getAuthorizeURL(redirectURI);
=> redirect to authorizeURL

// Step 2
const result = await component.queryAuth(code);
=> result.authorization_info.authorizer_access_token

// Step 3
const authorizerAppid = result.authorization_info.authorizer_appid;
=> await component.getAuthorizerInfo(authorizerAppid);
```

### Wrap wechat-api
```js
const util = require('util');
const API = require('wechat-api');
const api = new API(authorizerAppid, null, getToken, saveToken);

api.getAccessToken = async (callback) => {
  try {
    api.getTokenAsync = util.promisify(api.getToken);
    api.saveTokenAsync = util.promisify(api.saveToken);

    const refresh = await api.getTokenAsync();
    const result = await component.getAuthorizerToken(authorizerAppid, refresh.refreshToken); // not recommended, should use a center server
    const token = {
      accessToken: result.authorizer_access_token,
      refreshToken: result.authorizer_refresh_token,
      expireTime: new Date().getTime() + ((result.expires_in - 10) * 1000),
    };

    await api.saveTokenAsync(token);

    callback(null, token);
  } catch (e) {
    callback(e);
  }
};
```

### Wrap wechat-oauth
```js
const OAuth = require('wechat-oauth');
const oauth = new OAuth(authorizerAppid, null, getToken, saveToken);

oauth.getAccessToken = async (code, callback) => {
  const token = await component.getOAuthAccessToken(authorizerAppid, code);

  token.create_at = new Date().getTime();
  oauth.saveToken(authorizerAppid, token, err => callback(err, token));
};

oauth.refreshAccessToken = async (refreshToken, callback) => {
  const token = await component.refreshOAuthAccessToken(authorizerAppid, refreshToken);

  token.create_at = new Date().getTime();
  oauth.saveToken(authorizerAppid, token, err => callback(err, token));
};

oauth.getAuthorizeURL = (redirect, state, scope) => {
  return component.getOAuthAuthorizeURL(authorizerAppid, redirect, scope, state);
};
```
