import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import LakutataNodeHost

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    return true
  }
}

// The window of the application in its scene (the scene lifecycle, which the apps built with the iOS 27 SDK adopt)
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene,
          let factory = (UIApplication.shared.delegate as? AppDelegate)?.reactNativeFactory else { return }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    factory.startReactNative(withModuleName: "App", in: window, launchOptions: nil)
  }

  // The application goes to the background: Node.js is told so, and given the time to finish what it writes before
  // the system suspends the application (5 seconds at most)
  func sceneDidEnterBackground(_ scene: UIScene) {
    var task: UIBackgroundTaskIdentifier = .invalid
    let end = {
      if task != .invalid {
        UIApplication.shared.endBackgroundTask(task)
        task = .invalid
      }
    }
    task = UIApplication.shared.beginBackgroundTask(expirationHandler: end)
    DispatchQueue.global(qos: .userInitiated).async {
      LakutataNode.pause(withTimeout: 5)
      DispatchQueue.main.async(execute: end)
    }
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    LakutataNode.resume()
  }
}

class ReactNativeDelegate: LakutataReactNativeDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
