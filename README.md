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
    const token = await service.getAuthorizerToken(authorizerAppid, refresh.refreshToken);
    // service should use a Central Control Server

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

  oauth.saveToken(token.openid, token, err => callback(err, { data: token }));
};

oauth.refreshAccessToken = async (refreshToken, callback) => {
  const token = await component.refreshOAuthAccessToken(authorizerAppid, refreshToken);

  oauth.saveToken(token.openid, token, err => callback(err, { data: token }));
};

oauth.getAuthorizeURL = (redirect, state, scope) => component
  .getOAuthAuthorizeURL(authorizerAppid, redirect, scope, state);
```
