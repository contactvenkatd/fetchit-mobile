import { requireNativeModule } from 'expo-modules-core';

import type { AppAttestNativeModule } from './AppAttest.types';

export default requireNativeModule<AppAttestNativeModule>('AppAttest');
