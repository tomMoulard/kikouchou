/**
 * @fileoverview Public API for the auth feature.
 * @module features/auth
 */

export {
  AuthContext,
  AuthProvider,
  useAuth,
  type AuthContextValue,
  type PasskeyEnrolmentOutcome,
  type SignInOutcome,
} from './AuthContext';
export { getAccountDisplayName, getAccountGuestName } from './display-name';
export { SignInDialog } from './components/SignInDialog';
export { AccountSection } from './components/AccountSection';
export { ProviderList } from './components/ProviderList';
export { PasskeyEnrolment } from './components/PasskeyEnrolment';
export { useAuthProviders, type UseAuthProvidersResult } from './hooks/useAuthProviders';
export { authRoutes } from './routes';
export { isPasskeySupported } from './passkeys';
export { getAvailableWeb3Chains, getConfiguredWeb3Chains, type Web3Chain } from './web3';
