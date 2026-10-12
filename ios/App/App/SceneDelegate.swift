import SwiftUI
import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = UIHostingController(rootView: NativeRootView())
        self.window = window
        window.makeKeyAndVisible()
        for context in connectionOptions.urlContexts {
            NativeWorkoutRouter.shared.receive(context.url, store: NativeStore.shared)
        }
    }
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            NativeWorkoutRouter.shared.receive(context.url, store: NativeStore.shared)
        }
    }
}
