import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Before any scene: "Serie hecha" on the lock screen may launch FIT in the background.
        if !NativeApplicationLifecycle.isUnitTestHost {
            NativeApplicationLifecycle.shared.attach(store: NativeStore.shared)
            Task { @MainActor in await NativeApplicationLifecycle.shared.restore(store: NativeStore.shared) }
        }
        return true
    }
    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}
