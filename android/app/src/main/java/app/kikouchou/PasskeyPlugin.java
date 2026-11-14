package app.kikouchou;

import android.os.Build;
import android.os.CancellationSignal;

import androidx.core.content.ContextCompat;
import androidx.credentials.CreateCredentialResponse;
import androidx.credentials.CreatePublicKeyCredentialRequest;
import androidx.credentials.CreatePublicKeyCredentialResponse;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.GetPublicKeyCredentialOption;
import androidx.credentials.PublicKeyCredential;
import androidx.credentials.exceptions.CreateCredentialCancellationException;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.CreateCredentialProviderConfigurationException;
import androidx.credentials.exceptions.CreateCredentialUnsupportedException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException;
import androidx.credentials.exceptions.GetCredentialUnsupportedException;
import androidx.credentials.exceptions.NoCredentialException;
import androidx.credentials.exceptions.domerrors.AbortError;
import androidx.credentials.exceptions.domerrors.DomError;
import androidx.credentials.exceptions.domerrors.InvalidStateError;
import androidx.credentials.exceptions.domerrors.NotAllowedError;
import androidx.credentials.exceptions.domerrors.NotSupportedError;
import androidx.credentials.exceptions.domerrors.SecurityError;
import androidx.credentials.exceptions.publickeycredential.CreatePublicKeyCredentialDomException;
import androidx.credentials.exceptions.publickeycredential.GetPublicKeyCredentialDomException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Passkeys for app.kikouchou.app, through Android's Credential Manager.
 *
 * The WebView cannot do it. A passkey is bound to the rpId
 * `app.kikouchou.app`, and the page runs on `https://localhost`, which
 * Chromium refuses as an origin for that rpId even in the WebView's app mode.
 * Credential Manager asks for the passkey as this app instead, and
 * `assetlinks.json` (`delegate_permission/common.get_login_creds`) is what
 * lets the app use the website's passkeys. The signed response then carries
 * the origin `android:apk-key-hash:<signing key>`, which the Supabase project
 * accepts through `webauthn_rp_origins` (supabase/config.toml).
 *
 * The page talks WebAuthn JSON in both directions, so this class only moves
 * strings. The web side is src/lib/native/passkeys.ts.
 */
@CapacitorPlugin(name = "Passkeys")
public class PasskeyPlugin extends Plugin {

    /**
     * Whether a passkey provider can answer on this device. On Android 14 and
     * later the system provides one. Before that only Google Play services
     * does, and the F-Droid build leaves it out (`PASSKEYS_BELOW_ANDROID_14` in
     * app/build.gradle), so the plugin is not registered there and the page
     * offers no passkey.
     */
    static boolean isSupported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE || BuildConfig.PASSKEYS_BELOW_ANDROID_14;
    }

    private CredentialManager credentialManager;

    @Override
    public void load() {
        credentialManager = CredentialManager.create(getContext());
    }

    /** `navigator.credentials.get`: signs in with a passkey. */
    @PluginMethod
    public void get(PluginCall call) {
        String requestJson = call.getString("requestJson");
        if (requestJson == null || requestJson.isEmpty()) {
            call.reject("No passkey request", "NotSupportedError");
            return;
        }

        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(new GetPublicKeyCredentialOption(requestJson))
            .build();

        credentialManager.getCredentialAsync(
            getActivity(),
            request,
            new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    Credential credential = response.getCredential();
                    if (!(credential instanceof PublicKeyCredential)) {
                        call.reject("Not a passkey", "NotSupportedError");
                        return;
                    }
                    call.resolve(result(((PublicKeyCredential) credential).getAuthenticationResponseJson()));
                }

                @Override
                public void onError(GetCredentialException error) {
                    call.reject(message(error.getErrorMessage()), getErrorName(error));
                }
            }
        );
    }

    /** `navigator.credentials.create`: adds a passkey to the signed-in account. */
    @PluginMethod
    public void create(PluginCall call) {
        String requestJson = call.getString("requestJson");
        if (requestJson == null || requestJson.isEmpty()) {
            call.reject("No passkey request", "NotSupportedError");
            return;
        }

        credentialManager.createCredentialAsync(
            getActivity(),
            new CreatePublicKeyCredentialRequest(requestJson),
            new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                @Override
                public void onResult(CreateCredentialResponse response) {
                    if (!(response instanceof CreatePublicKeyCredentialResponse)) {
                        call.reject("Not a passkey", "NotSupportedError");
                        return;
                    }
                    call.resolve(result(((CreatePublicKeyCredentialResponse) response).getRegistrationResponseJson()));
                }

                @Override
                public void onError(CreateCredentialException error) {
                    call.reject(message(error.getErrorMessage()), createErrorName(error));
                }
            }
        );
    }

    private static JSObject result(String responseJson) {
        JSObject result = new JSObject();
        result.put("responseJson", responseJson);
        return result;
    }

    private static String message(CharSequence message) {
        return message == null ? "Passkey request failed" : message.toString();
    }

    /**
     * The DOMException name a browser would throw for the same outcome. The
     * page throws it as one, so auth-js reads a cancelled sheet in the app the
     * way it reads a cancelled browser prompt.
     */
    private static String getErrorName(GetCredentialException error) {
        if (error instanceof GetCredentialCancellationException || error instanceof NoCredentialException) {
            return "NotAllowedError";
        }
        if (error instanceof GetCredentialUnsupportedException || error instanceof GetCredentialProviderConfigurationException) {
            return "NotSupportedError";
        }
        if (error instanceof GetPublicKeyCredentialDomException) {
            return domErrorName(((GetPublicKeyCredentialDomException) error).getDomError());
        }
        return "UnknownError";
    }

    private static String createErrorName(CreateCredentialException error) {
        if (error instanceof CreateCredentialCancellationException) {
            return "NotAllowedError";
        }
        if (error instanceof CreateCredentialUnsupportedException || error instanceof CreateCredentialProviderConfigurationException) {
            return "NotSupportedError";
        }
        if (error instanceof CreatePublicKeyCredentialDomException) {
            return domErrorName(((CreatePublicKeyCredentialDomException) error).getDomError());
        }
        return "UnknownError";
    }

    /** By type, not by class name: R8 renames the classes in a release build. */
    private static String domErrorName(DomError error) {
        if (error instanceof NotAllowedError) {
            return "NotAllowedError";
        }
        if (error instanceof InvalidStateError) {
            return "InvalidStateError";
        }
        if (error instanceof SecurityError) {
            return "SecurityError";
        }
        if (error instanceof NotSupportedError) {
            return "NotSupportedError";
        }
        if (error instanceof AbortError) {
            return "AbortError";
        }
        return "UnknownError";
    }
}
