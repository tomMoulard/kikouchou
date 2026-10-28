import Capacitor

/// The bridge, with the app's own plugins registered. Plugins from npm are
/// found through Swift Package Manager; one that lives in this target has to
/// be handed to the bridge by hand.
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ContactSearchPlugin())
    }
}
