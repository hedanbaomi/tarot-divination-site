import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    private var webViewController: WebAppViewController? {
        (window?.rootViewController as? UINavigationController)?.viewControllers.first as? WebAppViewController
    }

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        let webViewController = WebAppViewController()
        let navigationController = UINavigationController(rootViewController: webViewController)
        window.rootViewController = navigationController
        window.makeKeyAndVisible()
        self.window = window
        return true
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        webViewController?.applicationDidBecomeActive()
    }

    func applicationWillResignActive(_ application: UIApplication) {
        webViewController?.applicationWillResignActive()
    }
}
