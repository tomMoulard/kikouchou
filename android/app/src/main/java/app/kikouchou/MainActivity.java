package app.kikouchou;

import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.EdgeToEdge;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.util.Locale;

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
        // to the page. On an older one, SystemBars pads the window instead.
        // Called before `super.onCreate`, which sets the content view.
        if (webViewMajorVersion() >= WEBVIEW_WITH_SAFE_AREA_INSETS) {
            EdgeToEdge.enable(this);
        }
        // The app's own plugins register before the bridge starts.
        registerPlugin(ContactSearchPlugin.class);
        super.onCreate(savedInstanceState);
        publishStatusBarInset();
    }

    /**
     * Hands the page the height of the status bar alone, as the CSS variable
     * `--app-inset-top`, which the header pads itself with (`src/index.css`).
     *
     * `env(safe-area-inset-top)` is the larger of the status bar and the
     * display cutout, and on a Fairphone 4 (Android 15, WebView 157) it came
     * to 93 CSS px under a status bar of about 37: the header stood a
     * toolbar's height below the status bar, over a band of stale pixels. The
     * status bar itself already clears the cutout. The raw numbers go to
     * `window.__kikouchouInsets` too, for `lib/native/layout-probe`.
     */
    private void publishStatusBarInset() {
        WebView webView = getBridge().getWebView();
        webView.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) ->
            injectStatusBarInset(webView)
        );
        getBridge()
            .addWebViewListener(
                new WebViewListener() {
                    @Override
                    public void onPageLoaded(WebView loaded) {
                        injectStatusBarInset(loaded);
                    }
                }
            );
    }

    private void injectStatusBarInset(WebView webView) {
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(webView);
        if (insets == null) {
            return;
        }
        float density = getResources().getDisplayMetrics().density;
        Insets statusBars = insets.getInsets(WindowInsetsCompat.Type.statusBars());
        Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
        // The WebView's own position on screen: 0 when it draws under the
        // status bar, the status bar's height when the window sits below it.
        int[] location = new int[2];
        webView.getLocationOnScreen(location);
        float statusTop = Math.max(0, statusBars.top - location[1]) / density;
        String script = String.format(
            Locale.ROOT,
            "document.documentElement.style.setProperty('--app-inset-top','%.1fpx');" +
            "window.__kikouchouInsets={status_top:%.1f,cutout_top:%.1f,webview_top:%.1f,density:%.3f};",
            statusTop,
            statusTop,
            cutout.top / density,
            location[1] / density,
            density
        );
        webView.post(() -> webView.evaluateJavascript(script, null));
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
