import Capacitor

// Local app plugins are absent from Capacitor's generated package registry.
// Register instances after bridge construction and before the WebView loads;
// registerPluginType is a no-op with Capacitor 8's default auto-registration.
class F1tBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(F1tWidgetPlugin())
        bridge?.registerPluginInstance(F1tActivityPlugin())
    }
}
