const { createRunOncePlugin, withEntitlementsPlist } = require('expo/config-plugins');

const ENTITLEMENT = 'com.apple.developer.devicecheck.appattest-environment';
const VALID_ENVIRONMENTS = new Set(['development', 'production']);

const withAppAttest = (config, options = {}) =>
  withEntitlementsPlist(config, (cfg) => {
    const environment = options.environment;
    if (!VALID_ENVIRONMENTS.has(environment)) {
      throw new Error('[with-app-attest] environment must be exactly "development" or "production".');
    }
    const current = cfg.modResults[ENTITLEMENT];
    if (current && current !== environment) {
      throw new Error(
        `[with-app-attest] Refusing to replace App Attest environment "${current}" ` +
          `with "${environment}". Keep app config and the EAS profile aligned.`
      );
    }
    cfg.modResults[ENTITLEMENT] = environment;
    return cfg;
  });

module.exports = createRunOncePlugin(withAppAttest, 'fetchit-app-attest', '1.0.0');
module.exports.ENTITLEMENT = ENTITLEMENT;
module.exports.VALID_ENVIRONMENTS = VALID_ENVIRONMENTS;
