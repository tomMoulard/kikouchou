/**
 * @fileoverview Error Boundary component for graceful error handling.
 * Catches JavaScript errors in the component tree and displays a user-friendly
 * fallback UI with retry functionality.
 *
 * Note: Error Boundaries must be class components in React - they cannot be
 * implemented as functional components because they require the
 * `getDerivedStateFromError` and `componentDidCatch` lifecycle methods.
 *
 * @module components/shared/ErrorBoundary
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type TFunction } from 'i18next';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the ErrorBoundary component.
 */
interface ErrorBoundaryProps {
  /** Child components to render when no error has occurred */
  readonly children: ReactNode;
  /** Optional custom fallback UI to display instead of the default error UI */
  readonly fallback?: ReactNode;
  /** Callback invoked when an error is caught */
  readonly onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Callback invoked when the user clicks the retry button */
  readonly onReset?: () => void;
  /** Additional CSS classes for the error container */
  readonly className?: string;
}

/**
 * Internal props for the class component including the translation function.
 */
interface ErrorBoundaryClassProps extends ErrorBoundaryProps {
  /** Translation function from react-i18next */
  readonly t: TFunction;
}

/**
 * State for the ErrorBoundary class component.
 */
interface ErrorBoundaryState {
  /** Whether an error has been caught */
  readonly hasError: boolean;
  /** The caught error, if any */
  readonly error: Error | null;
  /** React error info with component stack, if available */
  readonly errorInfo: ErrorInfo | null;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Initial state for the error boundary.
 */
const INITIAL_STATE: ErrorBoundaryState = {
  hasError: false,
  error: null,
  errorInfo: null,
};

/**
 * Whether the app is running in development mode.
 */
const IS_DEVELOPMENT = import.meta.env.DEV;

// ============================================================================
// Class Component
// ============================================================================

/**
 * Inner class component that implements the error boundary logic.
 * Wrapped by a functional component to integrate with react-i18next hooks.
 */
class ErrorBoundaryClass extends Component<ErrorBoundaryClassProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryClassProps) {
    super(props);
    this.state = INITIAL_STATE;
  }

  /**
   * Update state when an error is caught during rendering.
   * Called during the "render" phase, so side-effects are not permitted.
   */
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  /**
   * Called after an error has been thrown by a descendant component.
   * Used for error logging and reporting.
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Update state with error info
    this.setState({ errorInfo });

    // Call the onError callback if provided
    const { onError } = this.props;
    if (onError) {
      try {
        onError(error, errorInfo);
      } catch (callbackError) {
        // Prevent cascade failures from callback errors
        console.error('ErrorBoundary: onError callback threw an error:', callbackError);
      }
    }

    // Log error in development
    if (IS_DEVELOPMENT) {
      console.error('ErrorBoundary caught an error:', error);
      console.error('Component stack:', errorInfo.componentStack);
    }
  }

  /**
   * Reset the error boundary state to allow re-rendering children.
   */
  resetErrorBoundary = (): void => {
    const { onReset } = this.props;

    // Call the onReset callback if provided
    if (onReset) {
      try {
        onReset();
      } catch (callbackError) {
        // Log but don't prevent reset
        console.error('ErrorBoundary: onReset callback threw an error:', callbackError);
      }
    }

    // Reset internal state
    this.setState(INITIAL_STATE);
  };

  /**
   * Safely call translation function with fallback.
   * Prevents cascading failures if i18n context is broken.
   */
  private safeTranslate(key: string, fallback: string): string {
    try {
      const result = this.props.t(key, fallback);
      return typeof result === 'string' ? result : fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * Render the error boundary.
   */
  render(): ReactNode {
    const { hasError, error, errorInfo } = this.state;
    const { children, fallback, className } = this.props;

    // Render children if no error
    if (!hasError) {
      return children;
    }

    // Render custom fallback if provided
    if (fallback !== undefined) {
      return fallback;
    }

    // Get error details safely for development display
    const errorMessage = error?.message;
    const errorStack = error?.stack;
    const componentStack = errorInfo?.componentStack;

    // Render default error UI with safe translations
    return (
      <div
        role="alert"
        aria-live="assertive"
        className={cn(
          'flex flex-col items-center justify-center px-4 py-12 text-center',
          'max-w-md mx-auto',
          className,
        )}
      >
        {/* Error icon */}
        <div className="mb-4">
          <AlertTriangle
            className="size-12 text-destructive"
            aria-hidden="true"
          />
        </div>

        {/* Error heading */}
        <h2 className="text-lg font-semibold text-foreground text-balance">
          {this.safeTranslate('errors.generic', 'An error occurred')}
        </h2>

        {/* Error description */}
        <p className="mt-2 text-sm text-muted-foreground text-pretty">
          {this.safeTranslate('errors.loadingFailed', 'Failed to load this content. Please try again.')}
        </p>

        {/* Retry button */}
        <div className="mt-6">
          <Button onClick={this.resetErrorBoundary}>
            <RefreshCw className="mr-2 size-4" aria-hidden="true" />
            {this.safeTranslate('common.retry', 'Retry')}
          </Button>
        </div>

        {/* Development-only error details */}
        {IS_DEVELOPMENT && (errorMessage || errorStack || componentStack) && (
          <details className="mt-8 w-full text-left">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
              {this.safeTranslate('errors.details', 'Error details (development only)')}
            </summary>
            <div className="mt-2 rounded-md bg-muted p-4 text-xs font-mono overflow-auto max-h-64">
              {errorMessage && (
                <div className="mb-2">
                  <strong className="text-destructive">Error:</strong>
                  <pre className="mt-1 whitespace-pre-wrap break-words">
                    {errorMessage}
                  </pre>
                </div>
              )}
              {errorStack && (
                <div className="mb-2">
                  <strong className="text-muted-foreground">Stack trace:</strong>
                  <pre className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                    {errorStack}
                  </pre>
                </div>
              )}
              {componentStack && (
                <div>
                  <strong className="text-muted-foreground">Component stack:</strong>
                  <pre className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                    {componentStack}
                  </pre>
                </div>
              )}
            </div>
          </details>
        )}
      </div>
    );
  }
}

// ============================================================================
// Wrapper Component
// ============================================================================

/**
 * Error Boundary component that catches JavaScript errors in the component tree
 * and displays a user-friendly fallback UI with retry functionality.
 *
 * This component wraps a class-based error boundary with a functional component
 * to enable react-i18next hook integration.
 *
 * @param props - Component props
 * @returns The error boundary wrapper
 *
 * @example
 * ```tsx
 * import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
 *
 * // Basic usage
 * function App() {
 *   return (
 *     <ErrorBoundary>
 *       <MainContent />
 *     </ErrorBoundary>
 *   );
 * }
 *
 * // With callbacks for error tracking
 * function AppWithTracking() {
 *   const handleError = (error, errorInfo) => {
 *     // Send to error tracking service
 *     trackError(error, errorInfo);
 *   };
 *
 *   const handleReset = () => {
 *     // Clear any cached data that might have caused the error
 *     clearCache();
 *   };
 *
 *   return (
 *     <ErrorBoundary onError={handleError} onReset={handleReset}>
 *       <MainContent />
 *     </ErrorBoundary>
 *   );
 * }
 *
 * // With custom fallback UI
 * function AppWithCustomFallback() {
 *   return (
 *     <ErrorBoundary fallback={<CustomErrorPage />}>
 *       <MainContent />
 *     </ErrorBoundary>
 *   );
 * }
 * ```
 */
function ErrorBoundary({
  children,
  fallback,
  onError,
  onReset,
  className,
}: ErrorBoundaryProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <ErrorBoundaryClass
      t={t}
      fallback={fallback}
      onError={onError}
      onReset={onReset}
      className={className}
    >
      {children}
    </ErrorBoundaryClass>
  );
}

// ============================================================================
// Exports
// ============================================================================

export { ErrorBoundary };
export type { ErrorBoundaryProps };
