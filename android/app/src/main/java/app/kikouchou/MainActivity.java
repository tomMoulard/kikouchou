package app.kikouchou;

import android.os.Bundle;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Draw under the system bars on every Android version, not only on
        // Android 15 and later, where a target SDK of 35 or more forces it.
        // The web view then gets the same insets everywhere: Capacitor's
        // SystemBars plugin (`insetsHandling: 'native'` in capacitor.config.ts)
        // hands them to `env(safe-area-inset-*)` in `src/index.css`, or pads
        // the view itself on a WebView too old to report them. Called before
        // `super.onCreate`, which sets the content view.
        EdgeToEdge.enable(this);
        // The app's own plugins register before the bridge starts.
        registerPlugin(ContactSearchPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
