// Runs before page scripts in each remote sign-in page, frame, and popup.
function disableLoginPasskeys() {
  var credentials = window.CredentialsContainer && window.CredentialsContainer.prototype;
  if (credentials) {
    ["get", "create"].forEach(function (method) {
      var original = credentials[method];
      if (typeof original !== "function") return;
      Object.defineProperty(credentials, method, {
        configurable: true,
        writable: true,
        value: function (options) {
          if (options && "publicKey" in Object(options)) {
            return Promise.reject(new DOMException(
              "Passkeys are unavailable in this remote sign-in browser. Choose another sign-in method.",
              "NotSupportedError"
            ));
          }
          return original.apply(this, arguments);
        },
      });
    });
  }
  // Feature detection should choose password/email instead of host-native authenticator UI.
  Object.defineProperty(window, "PublicKeyCredential", { configurable: true, writable: true, value: undefined });
}

module.exports = { disableLoginPasskeys: disableLoginPasskeys };
