// Public configuration only. Backend secrets must never be read here.
const PRODUCTION_URL = 'https://fpphpncruohjlppqhfep.supabase.co';
const LIVE_KEY = 'pk_live_51Th9uUQg8UTscDtyq5PmFrg5LvlMc0KhzXpoSs3k42rBZfJkFOpaCQ6zSegBxrzIt0arakY1fB1MDeVi9FfZrSLA00uREA0Mlp';
const TEST_KEY = 'pk_test_51Th9ugHqjZ0DYGoFydiFTMk58JXPCXzCcJxpdj0dFWC11vdv4sTiFuE5JPwu74G4jc8wQThpG8f7jL3AtDfVv89A00LkDZYfo2';

module.exports = (env) => {
  const appEnvironment = env.APP_ENV || env.EAS_BUILD_PROFILE || 'development';
  if (!['production', 'preview', 'development', 'test'].includes(appEnvironment)) {
    throw new Error('APP_ENV must be production, preview, development, or test.');
  }
  const live = appEnvironment === 'production';
  if (env.EAS_BUILD_PROFILE && live !== (env.EAS_BUILD_PROFILE === 'production')) {
    throw new Error('APP_ENV conflicts with the EAS build profile.');
  }
  if (env.NODE_ENV === 'test' && live) {
    throw new Error('Automated tests cannot use live payments.');
  }
  const stripePublishableKey = env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || (live ? LIVE_KEY : TEST_KEY);
  if (!stripePublishableKey.startsWith(live ? 'pk_live_' : 'pk_test_')) {
    throw new Error('Stripe publishable key does not match APP_ENV.');
  }
  if (live && stripePublishableKey !== LIVE_KEY) {
    throw new Error('Production must use the approved Stripe publishable key.');
  }
  // Without staging configuration, local UI work remains possible but backend
  // requests go to localhost, never to the production project.
  const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL || (live ? PRODUCTION_URL : 'http://127.0.0.1:54321');
  const url = new URL(supabaseUrl);
  if (live && url.origin !== PRODUCTION_URL) {
    throw new Error('Production must use the FetchIt production Supabase project.');
  }
  if (!live && url.hostname === new URL(PRODUCTION_URL).hostname) {
    throw new Error('Test payments require a separate Supabase backend.');
  }
  const supabaseAnonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY || (live
    ? 'sb_publishable_j_SnlL8-OiV_ha4pWL1lHw_AQCmalXg'
    : 'sb_publishable_local_not_configured');
  if (/^(sb_secret_|sk_|rk_)/.test(supabaseAnonKey)) {
    throw new Error('Supabase client configuration requires a public key.');
  }
  if (supabaseAnonKey.split('.').length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(supabaseAnonKey.split('.')[1], 'base64url').toString());
      if (payload.role !== 'anon') throw new Error();
    } catch {
      throw new Error('Supabase client JWT must have the anon role.');
    }
  }
  return { appEnvironment, stripePublishableKey, supabaseUrl, supabaseAnonKey };
};
