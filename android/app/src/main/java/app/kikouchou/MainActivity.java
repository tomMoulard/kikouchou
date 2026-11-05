package app.kikouchou;

import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * The first WebView that reports the system bars to the page as
     * `env(safe-area-inset-*)`. Capacitor's SystemBars plugin uses the same
     * threshold (`WEBVIEW_VERSION_WITH_SAFE_AREA_FIX`).
     */
    private static final int WEBVIEW_WITH_SAFE_AREA_INSETS = 140;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Draw under the system bars before Android 15 too, where a target SDK
        // of 35 or more forces it, but only on a WebView that hands the insets
        // to the page (`env(safe-area-inset-*)`, read by the header and the
        // bottom edge in `src/index.css`). On an older one, SystemBars pads
        // the window instead, and Chrome 90's WebView then painted the sticky
        // header squashed: the logo and the trip name were flat bars, in 0.1.5
        // only. Called before `super.onCreate`, which sets the content view.
        if (webViewMajorVersion() >= WEBVIEW_WITH_SAFE_AREA_INSETS) {
            EdgeToEdge.enable(this);
        }
        // The app's own plugins register before the bridge starts.
        registerPlugin(ContactSearchPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /** The installed WebView's major version, or 0 when Android cannot say. */
    private static int webViewMajorVersion() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return 0;
        }
        try {
            PackageInfo info = WebView.getCurrentWebViewPackage();
            if (info == null || info.versionName == null) {
                return 0;
            }
            return Integer.parseInt(info.versionName.split("\\.")[0]);
        } catch (RuntimeException exception) {
            return 0;
        }
    }
}
