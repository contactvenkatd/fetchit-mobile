module.exports = ({ config }) => {
  const profile = process.env.EAS_BUILD_PROFILE;
  const environment = profile === 'production' || profile === 'preview'
    ? 'production'
    : 'development';
  const expo = structuredClone(config);
  expo.ios.entitlements['com.apple.developer.devicecheck.appattest-environment'] = environment;
  expo.plugins = expo.plugins.map((plugin) =>
    Array.isArray(plugin) && plugin[0] === './plugins/withAppAttest'
      ? [plugin[0], { environment }]
      : plugin
  );
  return { expo };
};
