package app.kikouchou;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.util.Locale;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // No `EdgeToEdge.enable(this)`. 0.1.5 to 0.1.9 called it, and on a
        // Fairphone 4 (Android 15, WebView 157) the WebView then reserved an
        // extra 57 CSS px strip at its top, which it never repainted: a stale,
        // squashed copy of the header sat there in every one of those
        // versions, and 0.1.4, without the call, had none. Android 15 draws
        // the app edge-to-edge anyway, and SystemBars pads the window by the
        // bars (`capacitor.config.ts`, `lib/native/viewport`).
        // The app's own plugins register before the bridge starts.
        registerPlugin(ContactSearchPlugin.class);
        super.onCreate(savedInstanceState);
        publishStatusBarInset();
    }

    /**
     * Hands the page the height of the status bar alone, as the CSS variable
     * `--app-inset-top`, which the header pads itself with (`src/index.css`),
     * when the page draws under the status bar.
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
        // Under the status bar, the header pads itself by the status bar
        // alone. Below it, the page keeps `env(safe-area-inset-top)`: 0 on a
        // sound WebView, and on the Fairphone 4 the 57px strip its WebView
        // reserves and never repaints, which the header then clears instead
        // of sitting under it with its menu button out of sight.
        String inset = statusTop > 0
            ? String.format(Locale.ROOT, "document.documentElement.style.setProperty('--app-inset-top','%.1fpx');", statusTop)
            : "document.documentElement.style.removeProperty('--app-inset-top');";
        String script = String.format(
            Locale.ROOT,
            "%s" +
            "window.__kikouchouInsets={status_top:%.1f,cutout_top:%.1f,webview_top:%.1f,density:%.3f};",
            inset,
            statusTop,
            cutout.top / density,
            location[1] / density,
            density
        );
        webView.post(() -> webView.evaluateJavascript(script, null));
    }
}
