// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Web only: these native modules crash the web dev server (Stripe imports
// native-only react-native internals; SecureStore has no web storage). Resolve
// them to stand-ins on web; native platforms resolve the real packages unchanged.
const WEB_STUBS = {
  '@stripe/stripe-react-native': path.resolve(__dirname, 'src/lib/web/stripe-react-native.web.tsx'),
  'expo-secure-store': path.resolve(__dirname, 'src/lib/web/expo-secure-store.web.ts'),
};
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && Object.hasOwn(WEB_STUBS, moduleName)) {
    return { type: 'sourceFile', filePath: WEB_STUBS[moduleName] };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
