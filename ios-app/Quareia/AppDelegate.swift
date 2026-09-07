import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        #if PUBLIC_TESTING
        NSLog("P0 app didFinish begin")
        #endif
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = WebAppViewController()
        #if PUBLIC_TESTING
        NSLog("P0 app root controller assigned")
        #endif
        window.makeKeyAndVisible()
        #if PUBLIC_TESTING
        NSLog("P0 app window visible")
        #endif
        self.window = window
        return true
    }
}
