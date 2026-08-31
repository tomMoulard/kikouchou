/**
 * @fileoverview Public API for the auth feature.
 * @module features/auth
 */

export {
  AuthContext,
  AuthProvider,
  useAuth,
  type AuthContextValue,
  type SignInOutcome,
} from './AuthContext';
export { SignInDialog } from './components/SignInDialog';
export { AccountSection } from './components/AccountSection';
